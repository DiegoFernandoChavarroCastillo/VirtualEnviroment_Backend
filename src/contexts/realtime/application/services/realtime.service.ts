import { Injectable } from '@nestjs/common';
import { RedisRepository } from '../../infrastructure/persistence/redis/redis.repository';
import { UserManagementClient } from '../../infrastructure/adapters/out/http/user-management.client';
import { ConnectionManagementClient } from '../../infrastructure/adapters/out/http/connection-management.client';
import { JoinMapUseCase } from '../use-cases/join-map.use-case';
import { UpdatePositionUseCase } from '../use-cases/update-position.use-case';
import { SendChatUseCase } from '../use-cases/send-chat.use-case';
import { AvatarPosition } from '../../domain/entities/avatar-position.entity';
import {
  UserJoinedEvent,
  UserLeftEvent,
  PositionUpdateEvent,
  ChatMessageEvent,
} from '../interfaces/events.interface';

@Injectable()
export class RealtimeService {
  constructor(
    private readonly redisRepository: RedisRepository,
    private readonly userManagementClient: UserManagementClient,
    private readonly connectionManagementClient: ConnectionManagementClient,
    private readonly joinMapUseCase: JoinMapUseCase,
    private readonly updatePositionUseCase: UpdatePositionUseCase,
    private readonly sendChatUseCase: SendChatUseCase,
  ) {}

  async handleUserJoin(
    userId: string,
    userEmail: string,
    socketId: string,
    initialX?: number,
    initialY?: number,
  ): Promise<UserJoinedEvent> {
    return await this.joinMapUseCase.execute(userId, userEmail, socketId, initialX, initialY);
  }

  async handleUserLeave(
    userId: string,
    socketId: string,
  ): Promise<UserLeftEvent> {
    await this.redisRepository.deleteUserData(userId);
    return {
      userId,
      timestamp: new Date().toISOString(),
    };
  }

  async updatePosition(
    userId: string,
    x: number,
    y: number,
  ): Promise<PositionUpdateEvent | null> {
    return await this.updatePositionUseCase.execute(userId, x, y);
  }

  async sendChatMessage(
    userId: string,
    message: string,
  ): Promise<ChatMessageEvent> {
    return await this.sendChatUseCase.execute(userId, message);
  }

  async getAllActivePositions(): Promise<AvatarPosition[]> {
    return await this.redisRepository.getAllPositions();
  }

  async getPosition(userId: string): Promise<AvatarPosition | null> {
    return await this.redisRepository.getPosition(userId);
  }

  async clearAllPresencesAndPositions(): Promise<void> {
    await this.redisRepository.clearAllMapData();
  }

  async createPresence(userId: string, socketId: string): Promise<void> {
    await this.redisRepository.setPresence(userId, socketId);
  }

  async removePresence(userId: string, socketId: string): Promise<void> {
    await this.redisRepository.deletePresence(userId);
  }
}
