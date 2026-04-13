import { Injectable } from '@nestjs/common';
import { RedisRepository } from '../../infrastructure/persistence/redis/redis.repository';
import { UserManagementClient } from '../../infrastructure/adapters/out/http/user-management.client';
import { ChatMessage } from '../../domain/entities/chat-message.entity';
import { ChatMessageEvent } from '../interfaces/events.interface';

@Injectable()
export class SendChatUseCase {
  constructor(
    private readonly redisRepository: RedisRepository,
    private readonly userManagementClient: UserManagementClient,
  ) {}

  async execute(userId: string, message: string): Promise<ChatMessageEvent> {
    // Validate message
    if (!message || message.trim().length === 0) {
      throw new Error('Message cannot be empty');
    }
    if (message.length > 500) {
      throw new Error('Message exceeds maximum length of 500 characters');
    }

    // Create chat message
    const messageId = `${userId}-${Date.now()}`;
    const chatMessage = new ChatMessage(userId, message);
    await this.redisRepository.setChatMessage(messageId, chatMessage, 60);

    // Fetch user profile
    const userProfile = await this.userManagementClient.getUserById(userId);

    return {
      userId,
      name: userProfile?.name || 'Unknown',
      message,
      timestamp: new Date().toISOString(),
    };
  }
}
