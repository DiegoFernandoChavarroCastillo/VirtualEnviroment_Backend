import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { UsePipes, ValidationPipe, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WsAuthMiddleware } from '../../common/middleware/ws-auth.middleware';
import { buildSocketIoCorsOptions } from '../../common/config/cors.config';
import { DuelEngineService } from './duel-engine.service';
import { DuelPadService } from './duel-pad.service';
import { CrownService } from './crown.service';
import { PlayerInputDto } from './dto/player-input.dto';
import { MatchEndedPayload } from './interfaces/football-duel.interfaces';

interface JoinMatchDto {
  matchId: string;
}

/**
 * Dedicated gateway for the 1v1 football match.
 * Namespace: /football-duel
 */
@WebSocketGateway({
  namespace: '/football-duel',
  cors: buildSocketIoCorsOptions(),
  // Performance optimizations for real-time game
  transports: ['websocket'], // Force WebSocket, skip polling
  pingTimeout: 60000, // 60s before considering connection dead
  pingInterval: 25000, // Send ping every 25s
  maxHttpBufferSize: 1e6, // 1MB buffer
  perMessageDeflate: false, // Disable compression for lower latency (critical for game)
  allowEIO3: true, // Support older clients if needed
})
@UsePipes(new ValidationPipe())
export class FootballDuelGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(FootballDuelGateway.name);

  /** socketId → matchId (for disconnect handling) */
  private socketToMatch = new Map<string, string>();

  constructor(
    private readonly duelEngine: DuelEngineService,
    private readonly duelPadService: DuelPadService,
    private readonly crownService: CrownService,
    private readonly wsAuth: WsAuthMiddleware,
  ) {}

  afterInit(server: Server) {
    // Give the engine a reference to this server so it can emit snapshots
    this.duelEngine.setDuelServer(server);

    // Wire up the match-ended callback
    this.duelEngine.setMatchEndedCallback(async (payload: MatchEndedPayload) => {
      await this.handleMatchEnded(payload);
    });

    // Wire up the duel-activated callback in DuelPadService
    this.duelPadService.setDuelActivatedCallback(
      async (p1Id, p1Name, p2Id, p2Name) =>
        this.duelEngine.createMatch(p1Id, p1Name, p2Id, p2Name),
    );

    this.logger.log('✅ FootballDuelGateway initialized on /football-duel namespace');
  }

  async handleConnection(client: Socket) {
    const user = await this.wsAuth.authenticate(client);
    if (!user) return;
    this.logger.log(`[/football-duel] Client connected: ${client.id} | userId=${user.sub}`);
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`[/football-duel] Client disconnected: ${client.id}`);

    const matchId = this.socketToMatch.get(client.id);
    if (!matchId) return;

    this.socketToMatch.delete(client.id);

    const user = client.data.user;
    if (user?.sub) {
      this.duelEngine.handlePlayerDisconnect(matchId, user.sub as string);
    }
  }

  // ─── Handlers ───────────────────────────────────────────────────────────────

  @SubscribeMessage('joinMatch')
  async handleJoinMatch(
    @MessageBody() payload: JoinMatchDto,
    @ConnectedSocket() client: Socket,
  ) {
    const { matchId } = payload;
    const state = this.duelEngine.getMatchState(matchId);

    if (!state) {
      client.emit('matchNotFound', { matchId });
      return;
    }

    // Join the Socket.IO room for this match
    await client.join(`match:${matchId}`);
    this.socketToMatch.set(client.id, matchId);

    // Send current state to the joining client
    client.emit('matchState', state);
    this.logger.log(`Client ${client.id} joined match ${matchId}`);
  }

  @SubscribeMessage('playerInput')
  handlePlayerInput(
    @MessageBody() payload: PlayerInputDto,
    @ConnectedSocket() client: Socket,
  ) {
    const user = client.data.user;
    if (!user?.sub) return;

    this.duelEngine.handlePlayerInput(payload.matchId, user.sub as string, {
      action: payload.action,
      dx: payload.dx,
      dy: payload.dy,
    });
  }

  // ─── Internal callback ───────────────────────────────────────────────────────

  private async handleMatchEnded(payload: MatchEndedPayload): Promise<void> {
    // Award crown if there's a winner
    if (payload.winnerId && payload.winnerName) {
      await this.crownService.awardCrown(payload.winnerId, payload.winnerName);
    }

    // Unlock pads so new duels can start
    await this.duelPadService.unlockPads();

    this.logger.log(
      `Match ${payload.matchId} ended. Winner: ${payload.winnerName ?? 'Draw'}`,
    );
  }
}
