/**
 * InMemoryRepository — single source of truth for ephemeral real-time state.
 *
 * Architectural decision: this microservice is intentionally STATEFUL and
 * must run as a single instance. All presence, positions, match state and
 * crown data live in process memory. The trade-off is that state does not
 * survive process restarts; this is acceptable because the service exposes
 * only ephemeral real-time data (no business-critical persistence).
 *
 * Horizontal scaling is NOT supported out of the box. If scaling is needed
 * in the future, introduce a Socket.IO adapter (Redis) and a shared state
 * layer (Redis/Postgres) and replace this repository.
 */
import { Injectable } from '@nestjs/common';
import { AvatarPosition } from '../../../domain/entities/avatar-position.entity';
import { ChatMessage } from '../../../domain/entities/chat-message.entity';
import {
  PadId,
  PadState,
  FootballDuelState,
  CrownState,
} from '../../../../../football-duel/interfaces/football-duel.interfaces';
import { ShooterRoomState } from '../../../../../shooter-arena/interfaces/shooter-arena.interfaces';

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface StoredPosition {
  userId: string;
  name: string;
  email: string;
  x: number;
  y: number;
  timestamp: string;
}

interface PadPresenceEntry {
  userId: string;
  socketId: string;
  timestamp: number;
}

// ─── Repositorio ─────────────────────────────────────────────────────────────

@Injectable()
export class InMemoryRepository {

  // ── Presencia ──────────────────────────────────────────────────────────────
  private readonly presenceMap = new Map<string, string>(); // userId → socketId

  // ── Posiciones ─────────────────────────────────────────────────────────────
  private readonly positionMap = new Map<string, StoredPosition>(); // userId → position
  private readonly userNameMap = new Map<string, string>();          // userId → name

  // ── Chat ───────────────────────────────────────────────────────────────────
  private readonly chatMap = new Map<string, { message: ChatMessage; expiresAt: number }>();

  // ── Duel pads ──────────────────────────────────────────────────────────────
  private readonly padPresenceMap = new Map<string, PadPresenceEntry>(); // `${padId}:${userId}` → entry
  private readonly padStateMap = new Map<PadId, PadState>();

  // ── Match state ────────────────────────────────────────────────────────────
  private readonly matchStateMap = new Map<string, FootballDuelState>(); // matchId → state

  // ── Crown ──────────────────────────────────────────────────────────────────
  private crownState: CrownState | null = null;

  // ── Shooter zone ───────────────────────────────────────────────────────────
  private shooterZoneState: { status: 'available' | 'locked'; activePlayers: number } | null = null;
  private readonly shooterZonePresenceMap = new Map<string, PadPresenceEntry>(); // userId → entry
  private shooterRoomState: ShooterRoomState | null = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // PRESENCE
  // ═══════════════════════════════════════════════════════════════════════════

  async setPresence(userId: string, socketId: string): Promise<void> {
    this.presenceMap.set(userId, socketId);
  }

  async getPresence(userId: string): Promise<string | null> {
    return this.presenceMap.get(userId) ?? null;
  }

  async deletePresence(userId: string): Promise<void> {
    this.presenceMap.delete(userId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POSITIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async saveUserName(userId: string, name: string): Promise<void> {
    this.userNameMap.set(userId, name);
  }

  async getUserName(userId: string): Promise<string | null> {
    return this.userNameMap.get(userId) ?? null;
  }

  async saveInitialPosition(
    userId: string,
    name: string,
    x: number,
    y: number,
    email = '',
  ): Promise<void> {
    this.positionMap.set(userId, {
      userId,
      name,
      email,
      x,
      y,
      timestamp: new Date().toISOString(),
    });
  }

  async updatePositionCoordinates(
    userId: string,
    x: number,
    y: number,
  ): Promise<{ success: boolean; name: string | null }> {
    const existing = this.positionMap.get(userId);
    if (!existing) {
      return { success: false, name: null };
    }
    existing.x = x;
    existing.y = y;
    existing.timestamp = new Date().toISOString();
    return { success: true, name: existing.name };
  }

  async getPosition(userId: string): Promise<AvatarPosition | null> {
    const stored = this.positionMap.get(userId);
    if (!stored) return null;
    return AvatarPosition.fromJSON(stored);
  }

  async deletePosition(userId: string): Promise<void> {
    this.positionMap.delete(userId);
  }

  async getAllPositions(): Promise<AvatarPosition[]> {
    const result: AvatarPosition[] = [];
    for (const [userId, stored] of this.positionMap) {
      // Solo devolver posiciones con presencia activa
      if (this.presenceMap.has(userId)) {
        result.push(AvatarPosition.fromJSON(stored));
      }
    }
    return result;
  }

  async deleteUserData(userId: string): Promise<void> {
    this.positionMap.delete(userId);
    this.presenceMap.delete(userId);
  }

  async clearAllMapData(): Promise<void> {
    this.positionMap.clear();
    this.presenceMap.clear();
  }

  /** @deprecated Usar saveInitialPosition */
  async setPosition(userId: string, position: AvatarPosition, _ttl: number): Promise<void> {
    await this.saveInitialPosition(userId, position.name, position.x, position.y);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHAT
  // ═══════════════════════════════════════════════════════════════════════════

  async setChatMessage(messageId: string, message: ChatMessage, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.chatMap.set(messageId, { message, expiresAt });
  }

  async getChatMessage(messageId: string): Promise<ChatMessage | null> {
    const entry = this.chatMap.get(messageId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.chatMap.delete(messageId);
      return null;
    }
    return entry.message;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DUEL PADS
  // ═══════════════════════════════════════════════════════════════════════════

  async setPadPresence(padId: PadId, userId: string, socketId: string): Promise<void> {
    this.padPresenceMap.set(`${padId}:${userId}`, { userId, socketId, timestamp: Date.now() });
  }

  async getPadPresence(padId: PadId, userId: string): Promise<PadPresenceEntry | null> {
    return this.padPresenceMap.get(`${padId}:${userId}`) ?? null;
  }

  async deletePadPresence(padId: PadId, userId: string): Promise<void> {
    this.padPresenceMap.delete(`${padId}:${userId}`);
  }

  async getPadOccupants(padId: PadId): Promise<string[]> {
    const prefix = `${padId}:`;
    const result: string[] = [];
    for (const key of this.padPresenceMap.keys()) {
      if (key.startsWith(prefix)) {
        result.push(key.slice(prefix.length));
      }
    }
    return result;
  }

  async setPadState(padId: PadId, state: PadState): Promise<void> {
    this.padStateMap.set(padId, state);
  }

  async getPadState(padId: PadId): Promise<PadState | null> {
    return this.padStateMap.get(padId) ?? null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MATCH STATE
  // ═══════════════════════════════════════════════════════════════════════════

  async setMatchState(matchId: string, state: FootballDuelState): Promise<void> {
    this.matchStateMap.set(matchId, state);
  }

  async getMatchState(matchId: string): Promise<FootballDuelState | null> {
    return this.matchStateMap.get(matchId) ?? null;
  }

  async deleteMatchState(matchId: string): Promise<void> {
    this.matchStateMap.delete(matchId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CROWN
  // ═══════════════════════════════════════════════════════════════════════════

  async setCrownState(state: CrownState, _ttlSeconds = 120): Promise<void> {
    this.crownState = state;
  }

  async getCrownState(): Promise<CrownState | null> {
    if (!this.crownState) return null;
    // Respetar el TTL en memoria
    if (Date.now() >= this.crownState.expiresAt) {
      this.crownState = null;
      return null;
    }
    return this.crownState;
  }

  async deleteCrownState(): Promise<void> {
    this.crownState = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHOOTER ZONE
  // ═══════════════════════════════════════════════════════════════════════════

  async setShooterZoneState(state: { status: 'available' | 'locked'; activePlayers: number }): Promise<void> {
    this.shooterZoneState = state;
  }

  async getShooterZoneState(): Promise<{ status: 'available' | 'locked'; activePlayers: number } | null> {
    return this.shooterZoneState;
  }

  async setShooterZonePresence(userId: string, socketId: string): Promise<void> {
    this.shooterZonePresenceMap.set(userId, { userId, socketId, timestamp: Date.now() });
  }

  async getShooterZonePresence(userId: string): Promise<PadPresenceEntry | null> {
    return this.shooterZonePresenceMap.get(userId) ?? null;
  }

  async deleteShooterZonePresence(userId: string): Promise<void> {
    this.shooterZonePresenceMap.delete(userId);
  }

  async setShooterRoomState(state: ShooterRoomState): Promise<void> {
    this.shooterRoomState = state;
  }

  async getShooterRoomState(): Promise<ShooterRoomState | null> {
    return this.shooterRoomState;
  }

  async deleteShooterRoomState(): Promise<void> {
    this.shooterRoomState = null;
  }
}
