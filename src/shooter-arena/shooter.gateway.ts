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
import { UseGuards, UsePipes, ValidationPipe, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ShooterEngineService } from './shooter-engine.service';
import { ZoneService } from './zone.service';
import { MAX_PLAYERS, ROOM_ID } from './interfaces/shooter-arena.interfaces';

interface JoinRoomDto {
  name?: string;
  roomId?: string;
}

interface PlayerInputDto {
  action: 'move' | 'shoot';
  dx?: number;
  dy?: number;
  aimDx?: number;
  aimDy?: number;
}

interface CheckShooterZoneDto {
  x: number;
  y: number;
}

/**
 * Gateway for the Arena Shooter 2D minigame.
 * Namespace: /shooter-arena
 */
@WebSocketGateway({
  namespace: '/shooter-arena',
  cors: { origin: '*', credentials: true },
  // Performance optimizations for real-time shooter game
  transports: ['websocket'], // Force WebSocket, skip polling
  pingTimeout: 60000, // 60s before considering connection dead
  pingInterval: 25000, // Send ping every 25s
  maxHttpBufferSize: 1e6, // 1MB buffer
  perMessageDeflate: false, // Disable compression for lower latency (critical for shooter)
  allowEIO3: true, // Support older clients if needed
})
@UsePipes(new ValidationPipe({ transform: true }))
export class ShooterGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ShooterGateway.name);

  /** socketId → userId (for disconnect handling) */
  private socketToUser = new Map<string, string>();

  constructor(
    private readonly engine: ShooterEngineService,
    private readonly zoneService: ZoneService,
    private readonly jwtService: JwtService,
  ) {}

  private async verifyToken(token: string): Promise<any> {
    return await this.jwtService.verifyAsync(token, {
      secret: process.env.JWT_SECRET || 'dev-secret-key',
    });
  }

  afterInit(server: Server) {
    this.server = server;
    this.engine.setServer(server);
    // Limpiar estado de zona cuando un jugador es eliminado por applyHit
    this.engine.setOnPlayerEliminatedCallback((userId: string) => {
      this.zoneService.clearTriggered(userId);
    });
    this.logger.log('✅ ShooterGateway initialized on /shooter-arena namespace');
  }

  handleConnection(client: Socket) {
    this.logger.log(`[/shooter-arena] Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`[/shooter-arena] Client disconnected: ${client.id}`);

    const userId = this.socketToUser.get(client.id);
    if (!userId) return;

    this.socketToUser.delete(client.id);

    // Mark as disconnected (10 s reconnection window)
    this.engine.markDisconnected(userId);
    this.zoneService.clearTriggered(userId);

    // Update zone state
    const activePlayers = this.engine.getActivePlayers();
    await this.zoneService.unlockZone(activePlayers);
  }

  // ─── Handlers ───────────────────────────────────────────────────────────────

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() payload: JoinRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    // Manual JWT verification
    const token = client.handshake.auth?.token;
    if (!token) {
      this.logger.error(`[ShooterGateway] No authentication token provided`);
      client.emit('error', { message: 'Authentication token missing' });
      return;
    }
    
    try {
      const payload_jwt = await this.verifyToken(token);
      client.data.user = payload_jwt;
    } catch (error) {
      this.logger.error(`[ShooterGateway] Token verification failed: ${error.message}`);
      client.emit('error', { message: 'Invalid authentication token' });
      return;
    }
    
    const userId = client.data.user?.sub as string;
    const requestedRoomId = payload?.roomId ?? ROOM_ID;
    const playerName = payload?.name ?? 'Player';

    if (!userId) {
      this.logger.error(`[ShooterGateway] Join denied: userId missing from JWT`);
      client.emit('error', { message: 'Authentication required' });
      return;
    }

    const activePlayers = this.engine.getActivePlayers();
    if (activePlayers >= MAX_PLAYERS) {
      client.emit('roomFull', { roomId: requestedRoomId, maxPlayers: MAX_PLAYERS });
      return;
    }

    // 1. Join socket.io room FIRST
    client.join(requestedRoomId);

    try {
      // 2. Add player to engine
      this.engine.addPlayer(userId, playerName, client.id);
      this.socketToUser.set(client.id, userId);
      
      const roomState = this.engine.getRoomState();
      this.logger.log(`[ShooterGateway] Player ${playerName} joined. Active players: ${roomState.players.length}`);
      
      // Notify EVERYONE in the room about the new player
      this.server.to(requestedRoomId).emit('roomState', roomState);
      
      // Also send a direct welcome to the joiner
      client.emit('roomState', roomState);
    } catch (error) {
      this.logger.error(`[ShooterGateway] Error adding player: ${error.message}`);
    }

    // Notify others
    client.to(requestedRoomId).emit('playerJoined', { userId, name: playerName });

    // Update zone state
    const newCount = this.engine.getActivePlayers();
    if (newCount >= MAX_PLAYERS) {
      await this.zoneService.lockZone(newCount);
    } else {
      await this.zoneService.unlockZone(newCount);
    }
  }

  @UseGuards(JwtAuthGuard)
  @SubscribeMessage('playerInput')
  handlePlayerInput(
    @MessageBody() payload: PlayerInputDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.user?.sub as string;
    if (!userId) return;

    this.engine.handlePlayerInput(userId, {
      action: payload.action,
      dx: payload.dx,
      dy: payload.dy,
      aimDx: payload.aimDx,
      aimDy: payload.aimDy,
    });
  }

  @UseGuards(JwtAuthGuard)
  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(@ConnectedSocket() client: Socket) {
    const userId = client.data.user?.sub as string;
    if (!userId) return;

    this.socketToUser.delete(client.id);
    this.engine.removePlayer(userId);
    this.zoneService.clearTriggered(userId);
    await client.leave(ROOM_ID);

    const activePlayers = this.engine.getActivePlayers();
    await this.zoneService.unlockZone(activePlayers);
  }

  @UseGuards(JwtAuthGuard)
  @SubscribeMessage('checkShooterZone')
  async handleCheckShooterZone(
    @MessageBody() payload: CheckShooterZoneDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.user?.sub as string;
    if (!userId) return;

    await this.zoneService.handleCheckShooterZone(
      userId,
      client.id,
      payload.x,
      payload.y,
      this.server,
    );
  }

  @UseGuards(JwtAuthGuard)
  @SubscribeMessage('requestRoomState')
  handleRequestRoomState(@ConnectedSocket() client: Socket) {
    const roomState = this.engine.getRoomState();
    client.emit('roomState', roomState);
  }
}
