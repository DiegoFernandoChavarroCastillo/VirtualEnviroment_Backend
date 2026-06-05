import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { UsePipes, ValidationPipe, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WsAuthMiddleware } from '../common/middleware/ws-auth.middleware';
import { buildSocketIoCorsOptions } from '../common/config/cors.config';
import { DuelPadService } from './duel-pad.service';
import { CrownService } from './crown.service';
import { CheckDuelPadsDto } from './dto/check-duel-pads.dto';

/**
 * Shares the /map namespace with VirtualMapGateway.
 * NestJS allows multiple gateways on the same namespace.
 * Handles the `checkDuelPads` event and broadcasts pad state updates.
 */
@WebSocketGateway({
  namespace: '/map',
  cors: buildSocketIoCorsOptions(),
})
@UsePipes(new ValidationPipe())
export class DuelPadGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(DuelPadGateway.name);

  constructor(
    private readonly duelPadService: DuelPadService,
    private readonly crownService: CrownService,
    private readonly wsAuth: WsAuthMiddleware,
  ) {}

  afterInit(server: Server) {
    this.duelPadService.setMapServer(server);
    this.crownService.setMapServer(server);
    this.logger.log('✅ DuelPadGateway initialized on /map namespace');
  }

  async handleConnection(client: Socket) {
    const user = await this.wsAuth.authenticate(client);
    if (!user) return;
    this.logger.log(`[DuelPadGateway] /map socket connected: ${client.id} | userId=${user.sub}`);
  }

  @SubscribeMessage('checkDuelPads')
  async handleCheckDuelPads(
    @MessageBody() payload: CheckDuelPadsDto,
    @ConnectedSocket() client: Socket,
  ) {
    const user = client.data.user;
    if (!user?.sub) {
      this.logger.warn(`checkDuelPads received without user.sub from client ${client.id}`);
      return;
    }

    const userId = user.sub as string;
    const userName = (user.name as string) || 'Unknown';

    const result = await this.duelPadService.handleCheckDuelPads(
      userId,
      userName,
      client.id,
      payload.x,
      payload.y,
    );

    if (result.blocked) {
      client.emit('padBlocked', { padId: result.padId });
    }
  }
}
