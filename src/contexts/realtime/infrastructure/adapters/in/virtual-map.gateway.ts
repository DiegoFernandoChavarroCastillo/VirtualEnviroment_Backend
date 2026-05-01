import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { UseGuards, UsePipes, ValidationPipe, Logger, Inject, Optional } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Throttle } from '@nestjs/throttler';
import { RealtimeService } from '../../../application/services/realtime.service';
import { JwtAuthGuard } from '../../../../../common/guards/jwt-auth.guard';
import { UpdatePositionDto } from '../../../application/dtos/update-position.dto';
import { SendChatDto } from '../../../application/dtos/send-chat.dto';
import { CheckShooterZoneDto } from '../../../../../shooter-arena/dto/check-shooter-zone.dto';

// Lazy import to avoid circular dependency — ZoneService lives in shooter-arena module
// We use a string token so RealtimeModule doesn't need to import ShooterArenaModule
export const ZONE_SERVICE_TOKEN = 'SHOOTER_ZONE_SERVICE';

@WebSocketGateway({
  namespace: '/map',
  cors: {
    origin: '*',
    credentials: true,
  },
  // Performance optimizations for production
  transports: ['websocket'], // Force WebSocket, skip polling
  pingTimeout: 60000, // 60s before considering connection dead
  pingInterval: 25000, // Send ping every 25s
  maxHttpBufferSize: 1e6, // 1MB buffer (default is 1MB, explicit for clarity)
  perMessageDeflate: false, // Disable compression for lower latency
  allowEIO3: true, // Support older clients if needed
})
@UsePipes(new ValidationPipe())
export class VirtualMapGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(VirtualMapGateway.name);

  constructor(
    private readonly realtimeService: RealtimeService,
    @Optional() @Inject(ZONE_SERVICE_TOKEN) private readonly zoneService: any,
  ) { }

  async afterInit(server: Server) {
    this.logger.log('✅ VirtualMapGateway initialized');
    this.logger.log('Running without Redis adapter (single instance mode)');

    // Inject the /map namespace server into ZoneService so it can emit
    // shooterJoined back to the correct client socket
    if (this.zoneService) {
      this.zoneService.setMapServer(server);
      this.logger.log('✅ ZoneService mapServer set from VirtualMapGateway');
    } else {
      this.logger.error('❌ ZoneService NOT FOUND in VirtualMapGateway constructor!');
    }

    // Clean up all stale positions and presences on startup
    await this.realtimeService.clearAllPresencesAndPositions();
    this.logger.log('Cleared all stale positions and presences from Redis');
  }

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token || client.handshake.headers?.authorization;
    this.logger.log(`Client connected: ${client.id} | token present: ${!!token}`);
    if (!token) {
      this.logger.warn(`Client ${client.id} connected WITHOUT token — joinMap will fail auth`);
    }
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    const user = client.data.user;
    if (user && user.sub) {
      const userId = user.sub;
      this.logger.log(`🧹 Cleaning up user data for userId=${userId}`);
      const event = await this.realtimeService.handleUserLeave(userId, client.id);
      this.server.emit('userLeft', event);
    } else {
      this.logger.warn(`Client ${client.id} disconnected with no user data — no cleanup needed`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @SubscribeMessage('leaveMap')
  async handleLeaveMap(@ConnectedSocket() client: Socket) {
    const user = client.data.user;
    if (user?.sub) {
      const event = await this.realtimeService.handleUserLeave(user.sub, client.id);
      this.server.emit('userLeft', event);
      this.logger.log(`User ${user.sub} left the map`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @SubscribeMessage('joinMap')
  async handleJoinMap(
    @MessageBody() payload: { x?: number; y?: number } | null,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const user = client.data.user;
      const userId = user.sub;
      const userEmail = user.email;

      const event = await this.realtimeService.handleUserJoin(
        userId,
        userEmail,
        client.id,
        payload?.x,
        payload?.y,
      );

      client.data.user.name = event.name;

      // Broadcast userJoined (with position) to all clients
      this.server.emit('userJoined', event);

      // Send all active positions to the joining client
      const positions = await this.realtimeService.getAllActivePositions();
      client.emit('initialPositions', positions);
    } catch (error) {
      this.logger.error(`Error in joinMap for client ${client.id}: ${error.message}`);

      // Send error to client
      client.emit('error', {
        code: error.message.includes('not found') ? 'USER_NOT_FOUND' : 'PROCESSING_ERROR',
        message: error.message,
        timestamp: new Date().toISOString(),
      });

      // Disconnect the client if user not found
      if (error.message.includes('not found')) {
        this.logger.warn(`Disconnecting client ${client.id} due to user not found`);
        client.disconnect();
      }
    }
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 1000 } }) // 60 requests per second (60 FPS for smooth gameplay)
  @SubscribeMessage('updatePosition')
  async handleUpdatePosition(
    @MessageBody() payload: UpdatePositionDto,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const user = client.data.user;
      const userId = user.sub;

      // Update position - name is preserved from initial position in Redis
      const event = await this.realtimeService.updatePosition(userId, payload.x, payload.y);

      if (!event) {
        this.logger.warn(`updatePosition ignored for userId=${userId} (no existing position)`);
        return;
      }

      // Broadcast to all except sender
      client.broadcast.emit('positionUpdate', event);
    } catch (error) {
      this.logger.error(`Error in updatePosition: ${error.message}`);
      client.emit('error', {
        code: 'PROCESSING_ERROR',
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  @UseGuards(JwtAuthGuard)
  @SubscribeMessage('sendChat')
  async handleSendChat(
    @MessageBody() payload: SendChatDto,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const user = client.data.user;
      const userId = user.sub;

      // Send chat message
      const event = await this.realtimeService.sendChatMessage(
        userId,
        payload.message,
      );

      // Broadcast to all clients
      this.server.emit('chatMessage', event);
    } catch (error) {
      this.logger.error(`Error in sendChat: ${error.message}`);
      client.emit('error', {
        code: error.message.includes('empty') || error.message.includes('exceeds')
          ? 'VALIDATION_ERROR'
          : 'PROCESSING_ERROR',
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Handles the shooter zone presence check from the /map namespace.
   * The client emits this every 200 ms while standing on the zone.
   * The server validates coordinates and emits `shooterJoined` when the
   * 2-second dwell time is confirmed server-side.
   */
  @UseGuards(JwtAuthGuard)
  @SubscribeMessage('checkShooterZone')
  async handleCheckShooterZone(
    @MessageBody() payload: CheckShooterZoneDto,
    @ConnectedSocket() client: Socket,
  ) {
    if (!this.zoneService) return;
    const user = client.data.user;
    if (!user?.sub) return;

    await this.zoneService.handleCheckShooterZone(
      user.sub as string,
      client.id,
      payload.x,
      payload.y,
      this.server,
    );
  }

  /**
   * Called when a player returns from the shooter arena to the virtual world.
   * Clears the triggered state so the player can re-enter the zone.
   */
  @UseGuards(JwtAuthGuard)
  @SubscribeMessage('clearShooterZone')
  handleClearShooterZone(@ConnectedSocket() client: Socket) {
    if (!this.zoneService) return;
    const user = client.data.user;
    if (!user?.sub) return;
    this.zoneService.clearTriggered(user.sub as string);
  }
}
