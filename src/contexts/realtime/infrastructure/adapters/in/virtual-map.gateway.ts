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
import { UseGuards, UsePipes, ValidationPipe, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Throttle } from '@nestjs/throttler';
import { RealtimeService } from '../../../application/services/realtime.service';
import { JwtAuthGuard } from '../../../../../common/guards/jwt-auth.guard';
import { UpdatePositionDto } from '../../../application/dtos/update-position.dto';
import { SendChatDto } from '../../../application/dtos/send-chat.dto';

@WebSocketGateway({
  namespace: '/map',
  cors: {
    origin: '*',
    credentials: true,
  },
})
@UsePipes(new ValidationPipe())
export class VirtualMapGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(VirtualMapGateway.name);

  constructor(private readonly realtimeService: RealtimeService) {}

  afterInit(server: Server) {
    // Redis adapter temporalmente deshabilitado - modo single instance
    this.logger.log('✅ VirtualMapGateway initialized');
    this.logger.log('Running without Redis adapter (single instance mode)');
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
    
    // Get user from client data (set by JwtAuthGuard)
    const user = client.data.user;
    if (user && user.sub) {
      const userId = user.sub;
      const event = await this.realtimeService.handleUserLeave(userId, client.id);
      
      // Broadcast userLeft to all clients
      this.server.emit('userLeft', event);
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
  async handleJoinMap(@ConnectedSocket() client: Socket) {
    try {
      const user = client.data.user;
      this.logger.log(`joinMap received from ${client.id} | user data: ${JSON.stringify(user)}`);
      const userId = user.sub;

      this.logger.log(`User ${userId} joining map`);

      // Handle user join
      const event = await this.realtimeService.handleUserJoin(userId, client.id);
      
      // Store name in client data for subsequent position updates
      client.data.user.name = event.name;

      // Broadcast userJoined to all clients
      this.server.emit('userJoined', event);

      // Send all active positions to the joining client
      const positions = await this.realtimeService.getAllActivePositions();
      client.emit('initialPositions', positions);
    } catch (error) {
      this.logger.error(`Error in joinMap: ${error.message}`);
      client.emit('error', {
        code: 'PROCESSING_ERROR',
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 1000 } }) // 20 requests per second (50ms throttle)
  @SubscribeMessage('updatePosition')
  async handleUpdatePosition(
    @MessageBody() payload: UpdatePositionDto,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      // Get user from client data
      const user = client.data.user;
      const userId = user.sub;
      const userName = user.name || 'Unknown';

      // Update position
      const event = await this.realtimeService.updatePosition(
        userId,
        userName,
        payload.x,
        payload.y,
      );

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
}
