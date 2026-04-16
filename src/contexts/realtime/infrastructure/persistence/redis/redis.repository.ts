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

  // ═══════════════════════════════════════════════════════════════════════════
  // PRESENCE OPERATIONS - Track active connections
  // ═══════════════════════════════════════════════════════════════════════════

  async setPresence(userId: string, socketId: string): Promise<void> {
    const key = `presence:${userId}`;
    await this.redis.setex(key, 300, socketId); // 5 min TTL
    console.log(`[RedisRepository] ✅ Set presence for userId=${userId} socketId=${socketId}`);
  }

  async getPresence(userId: string): Promise<string | null> {
    const key = `presence:${userId}`;
    return await this.redis.get(key);
  }

  async deletePresence(userId: string): Promise<void> {
    const key = `presence:${userId}`;
    const deleted = await this.redis.del(key);
    console.log(`[RedisRepository] 🗑️  Deleted presence for userId=${userId} (${deleted} keys removed)`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POSITION OPERATIONS - Immutable name, mutable coordinates
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Save initial position with IMMUTABLE name from user profile.
   * This should ONLY be called from JoinMapUseCase.
   */
  async saveInitialPosition(
    userId: string,
    name: string,
    x: number,
    y: number,
  ): Promise<void> {
    const key = `position:${userId}`;
    const position = {
      userId,
      name, // IMMUTABLE - never changes after this
      x,
      y,
      timestamp: new Date().toISOString(),
    };
    
    await this.redis.setex(key, 300, JSON.stringify(position)); // 5 min TTL
    console.log(`[RedisRepository] 💾 JoinMap - Guardando posición con nombre: "${name}" para userId=${userId}`);
  }

  /**
   * Update ONLY coordinates (x, y, timestamp).
   * Name field is NEVER modified.
   */
  async updatePositionCoordinates(
    userId: string,
    x: number,
    y: number,
  ): Promise<{ success: boolean; name: string | null }> {
    const key = `position:${userId}`;
    const existing = await this.redis.get(key);
    
    if (!existing) {
      console.warn(`[RedisRepository] ⚠️  UpdatePosition - No position found for userId=${userId}, ignoring update`);
      return { success: false, name: null };
    }

    const position = JSON.parse(existing);
    
    // Validate name is not "Unknown" - this should never happen
    if (position.name === 'Unknown') {
      console.error(`[RedisRepository] 🚨 WARNING: Position has name="Unknown" for userId=${userId}. This indicates a bug!`);
    }

    // Update ONLY coordinates and timestamp, preserve name
    position.x = x;
    position.y = y;
    position.timestamp = new Date().toISOString();
    
    await this.redis.setex(key, 300, JSON.stringify(position));
    console.log(`[RedisRepository] 📍 UpdatePosition - Actualizando solo coordenadas para userId=${userId} (name="${position.name}" preserved)`);
    
    return { success: true, name: position.name };
  }

  async getPosition(userId: string): Promise<AvatarPosition | null> {
    const key = `position:${userId}`;
    const value = await this.redis.get(key);
    if (!value) return null;
    return AvatarPosition.fromJSON(JSON.parse(value));
  }

  async deletePosition(userId: string): Promise<void> {
    const key = `position:${userId}`;
    const deleted = await this.redis.del(key);
    console.log(`[RedisRepository] 🗑️  Deleted position for userId=${userId} (${deleted} keys removed)`);
  }

  /**
   * Get all positions that have active presence.
   * Filters out stale positions without presence.
   */
  async getAllPositions(): Promise<AvatarPosition[]> {
    const keys = await this.redis.keys('position:*');
    console.log(`[RedisRepository] 🔍 getAllPositions: found ${keys.length} position keys`);
    
    if (keys.length === 0) return [];

    const values = await this.redis.mget(...keys);
    const activePositions: AvatarPosition[] = [];

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (!value) continue;

      const position = JSON.parse(value);
      const presence = await this.getPresence(position.userId);

      if (presence) {
        // Validate name
        if (position.name === 'Unknown') {
          console.error(`[RedisRepository] 🚨 WARNING: Returning position with name="Unknown" for userId=${position.userId}`);
        }
        
        activePositions.push(AvatarPosition.fromJSON(position));
        console.log(`[RedisRepository]   ✓ userId=${position.userId} name="${position.name}" has active presence`);
      } else {
        console.warn(`[RedisRepository]   ✗ userId=${position.userId} has stale position (no presence) — skipping`);
      }
    }

    console.log(`[RedisRepository] 📊 getAllPositions: returning ${activePositions.length} active positions`);
    return activePositions;
  }

  /**
   * Delete both position and presence for a user.
   * Used in disconnect/leave handlers.
   */
  async deleteUserData(userId: string): Promise<void> {
    await Promise.all([
      this.deletePosition(userId),
      this.deletePresence(userId),
    ]);
    console.log(`[RedisRepository] 🧹 Cleaned up all data for userId=${userId}`);
  }

  /**
   * Clear all map-related data on startup.
   */
  async clearAllMapData(): Promise<void> {
    const positionKeys = await this.redis.keys('position:*');
    const presenceKeys = await this.redis.keys('presence:*');
    const allKeys = [...positionKeys, ...presenceKeys];
    
    if (allKeys.length > 0) {
      await this.redis.del(...allKeys);
    }
    
    console.log(`[RedisRepository] 🧹 Startup cleanup: cleared ${allKeys.length} stale keys (${positionKeys.length} positions, ${presenceKeys.length} presences)`);
  }

  // Legacy method - kept for compatibility with old code
  async setPosition(
    userId: string,
    position: AvatarPosition,
    ttl: number,
  ): Promise<void> {
    console.warn(`[RedisRepository] ⚠️  setPosition() is deprecated, use saveInitialPosition() instead`);
    await this.saveInitialPosition(userId, position.name, position.x, position.y);
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
