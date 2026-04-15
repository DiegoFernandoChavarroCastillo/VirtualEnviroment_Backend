import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { AvatarPosition } from '../../../domain/entities/avatar-position.entity';
import { ChatMessage } from '../../../domain/entities/chat-message.entity';
import {
  PadId,
  PadState,
  FootballDuelState,
  CrownState,
} from '../../../../../football-duel/interfaces/football-duel.interfaces';

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

  // ─── DuelPad Presence (TTL 500 ms) ─────────────────────────────────────────

  async setPadPresence(padId: PadId, userId: string, socketId: string): Promise<void> {
    const key = `pad:presence:${padId}:${userId}`;
    const value = JSON.stringify({ userId, socketId, timestamp: Date.now() });
    // pexpire = millisecond TTL
    await this.redis.set(key, value, 'PX', 500);
  }

  async getPadPresence(padId: PadId, userId: string): Promise<{ userId: string; socketId: string; timestamp: number } | null> {
    const key = `pad:presence:${padId}:${userId}`;
    const value = await this.redis.get(key);
    if (!value) return null;
    return JSON.parse(value);
  }

  async deletePadPresence(padId: PadId, userId: string): Promise<void> {
    await this.redis.del(`pad:presence:${padId}:${userId}`);
  }

  /** Returns all userId keys currently present on a given pad */
  async getPadOccupants(padId: PadId): Promise<string[]> {
    const keys = await this.redis.keys(`pad:presence:${padId}:*`);
    return keys.map((k) => k.split(':').pop() as string);
  }

  // ─── DuelPad State ──────────────────────────────────────────────────────────

  async setPadState(padId: PadId, state: PadState): Promise<void> {
    await this.redis.set(`duelpad:${padId}:state`, JSON.stringify(state));
  }

  async getPadState(padId: PadId): Promise<PadState | null> {
    const value = await this.redis.get(`duelpad:${padId}:state`);
    if (!value) return null;
    return JSON.parse(value) as PadState;
  }

  // ─── Match State ────────────────────────────────────────────────────────────

  async setMatchState(matchId: string, state: FootballDuelState): Promise<void> {
    await this.redis.set(`match:${matchId}:state`, JSON.stringify(state));
  }

  async getMatchState(matchId: string): Promise<FootballDuelState | null> {
    const value = await this.redis.get(`match:${matchId}:state`);
    if (!value) return null;
    return JSON.parse(value) as FootballDuelState;
  }

  async deleteMatchState(matchId: string): Promise<void> {
    await this.redis.del(`match:${matchId}:state`);
  }

  // ─── Crown State (TTL 120 s) ────────────────────────────────────────────────

  async setCrownState(state: CrownState, ttlSeconds = 120): Promise<void> {
    await this.redis.set('crown:active', JSON.stringify(state), 'EX', ttlSeconds);
  }

  async getCrownState(): Promise<CrownState | null> {
    const value = await this.redis.get('crown:active');
    if (!value) return null;
    return JSON.parse(value) as CrownState;
  }

  async deleteCrownState(): Promise<void> {
    await this.redis.del('crown:active');
  }
}
