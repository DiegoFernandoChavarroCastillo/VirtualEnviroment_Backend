import { Injectable } from '@nestjs/common';
import { RedisRepository } from '../../infrastructure/persistence/redis/redis.repository';
import { ChatMessage } from '../../domain/entities/chat-message.entity';
import { ChatMessageEvent } from '../interfaces/events.interface';

@Injectable()
export class SendChatUseCase {
  constructor(
    private readonly redisRepository: RedisRepository,
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

    // Get name from Redis position (set immutably on join)
    const position = await this.redisRepository.getPosition(userId);

    return {
      userId,
      name: position?.name || userId,
      message,
      timestamp: new Date().toISOString(),
    };
  }
}
