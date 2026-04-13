import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { AvatarPosition } from '../../../domain/entities/avatar-position.entity';
import { ChatMessage } from '../../../domain/entities/chat-message.entity';

@Injectable()
export class RedisRepository {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    this.redis.on('connect', () => {
      console.log('Redis connected successfully');
    });

    this.redis.on('error', (error) => {
      console.error('Redis connection error:', error);
    });
  }

  // Presence operations
  async setPresence(userId: string, socketId: string): Promise<void> {
    const key = `presence:${userId}`;
    await this.redis.set(key, socketId);
  }

  async getPresence(userId: string): Promise<string | null> {
    const key = `presence:${userId}`;
    return await this.redis.get(key);
  }

  async deletePresence(userId: string): Promise<void> {
    const key = `presence:${userId}`;
    await this.redis.del(key);
  }

  // Position operations
  async setPosition(
    userId: string,
    position: AvatarPosition,
    ttl: number,
  ): Promise<void> {
    const key = `position:${userId}`;
    const value = JSON.stringify(position.toJSON());
    await this.redis.setex(key, ttl, value);
  }

  async getPosition(userId: string): Promise<AvatarPosition | null> {
    const key = `position:${userId}`;
    const value = await this.redis.get(key);
    if (!value) return null;
    return AvatarPosition.fromJSON(JSON.parse(value));
  }

  async getAllPositions(): Promise<AvatarPosition[]> {
    const keys = await this.redis.keys('position:*');
    if (keys.length === 0) return [];

    const values = await this.redis.mget(...keys);
    return values
      .filter((value) => value !== null)
      .map((value) => AvatarPosition.fromJSON(JSON.parse(value)));
  }

  // Chat operations
  async setChatMessage(
    messageId: string,
    message: ChatMessage,
    ttl: number,
  ): Promise<void> {
    const key = `chat:${messageId}`;
    const value = JSON.stringify(message.toJSON());
    await this.redis.setex(key, ttl, value);
  }

  async getChatMessage(messageId: string): Promise<ChatMessage | null> {
    const key = `chat:${messageId}`;
    const value = await this.redis.get(key);
    if (!value) return null;
    return ChatMessage.fromJSON(JSON.parse(value));
  }
}
