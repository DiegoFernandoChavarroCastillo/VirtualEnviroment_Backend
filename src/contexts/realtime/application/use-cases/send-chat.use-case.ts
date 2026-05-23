import { Injectable } from '@nestjs/common';
import { InMemoryRepository } from '../../infrastructure/persistence/in-memory/in-memory.repository';
import { ChatMessage } from '../../domain/entities/chat-message.entity';
import { ChatMessageEvent } from '../interfaces/events.interface';

@Injectable()
export class SendChatUseCase {
  constructor(
    private readonly redisRepository: InMemoryRepository,
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

    // Resolve display name: position key (5 min TTL) → dedicated name key (24 h TTL) → 'Usuario'
    const position = await this.redisRepository.getPosition(userId);
    const name =
      position?.name ||
      (await this.redisRepository.getUserName(userId)) ||
      'Usuario';

    return {
      userId,
      name,
      message,
      timestamp: new Date().toISOString(),
    };
  }
}
