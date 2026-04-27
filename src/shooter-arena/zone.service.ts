import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { Server } from 'socket.io';
import { RedisRepository } from '../contexts/realtime/infrastructure/persistence/redis/redis.repository';
import { ShooterEngineService } from './shooter-engine.service';
import {
  Vec2,
  SHOOTER_ZONE_RECT,
  ZONE_ENTRY_MS,
  MAX_PLAYERS,
} from './interfaces/shooter-arena.interfaces';

@Injectable()
export class ZoneService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZoneService.name);

  /**
   * Reference to the /map namespace server.
   * IMPORTANT: shooterJoined must be emitted on the /map namespace because
   * the client socket that sends checkShooterZone is connected to /map, not /shooter-arena.
   */
  private mapServer: Server | null = null;

  /** Callback invoked when a player successfully enters the zone */
  private onShooterJoined: ((userId: string, socketId: string) => void) | null = null;

  /**
   * Per-user entry tracking: { firstSeenAt, lastSeenAt }
   * We track wall-clock time to measure the 2s dwell window reliably,
   * independent of polling intervals or emit frequency.
   */
  private entryTracking = new Map<string, { firstSeenAt: number; lastSeenAt: number; socketId: string }>();

  /** Players that have already been triggered (prevent double-join) */
  private triggered = new Set<string>();

  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly redis: RedisRepository,
    @Inject(forwardRef(() => ShooterEngineService))
    private readonly engine: ShooterEngineService,
  ) {}

  async onModuleInit() {
    // Poll every 100 ms to expire stale entries (player walked away without sending an event)
    this.pollingInterval = setInterval(() => this.expireStaleEntries(), 100);
    
    // Reset zone state on startup to avoid stale 'locked' state from previous sessions
    await this.redis.setShooterZoneState({ status: 'available', activePlayers: 0 });
    this.logger.log('[Zone] Zone state reset to available on startup');
  }

  onModuleDestroy() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  setMapServer(server: Server) {
    this.mapServer = server;
  }

  setShooterJoinedCallback(cb: (userId: string, socketId: string) => void) {
    this.onShooterJoined = cb;
  }

  /** Point-in-rectangle hit-test (inclusive bounds). */
  isInsideZone(pos: Vec2, zone: { x: number; y: number; width: number; height: number }): boolean {
    return (
      pos.x >= zone.x &&
      pos.x <= zone.x + zone.width &&
      pos.y >= zone.y &&
      pos.y <= zone.y + zone.height
    );
  }

  /**
   * Called by VirtualMapGateway on every `checkShooterZone` event (~200ms).
   * Uses wall-clock time to measure the 2s dwell window accurately.
   */
  async handleCheckShooterZone(
    userId: string,
    socketId: string,
    x: number,
    y: number,
    server: Server,
  ): Promise<void> {
    if (this.triggered.has(userId)) return;

    if (!this.isInsideZone({ x, y }, SHOOTER_ZONE_RECT)) {
      this.entryTracking.delete(userId);
      return;
    }

    // Check if zone is locked (full)
    const zoneState = await this.redis.getShooterZoneState();
    if (zoneState?.status === 'locked') {
      const mapSrv = this.mapServer ?? server;
      mapSrv.to(socketId).emit('zoneBlocked', { reason: 'Room is full' });
      return;
    }

    const now = Date.now();
    const existing = this.entryTracking.get(userId);

    if (!existing) {
      // First time seeing this player in the zone
      this.entryTracking.set(userId, { firstSeenAt: now, lastSeenAt: now, socketId });
      return;
    }

    // Update last seen and socketId (may change on reconnect)
    existing.lastSeenAt = now;
    existing.socketId = socketId;

    const dwellMs = now - existing.firstSeenAt;

    if (dwellMs >= ZONE_ENTRY_MS) {
      // Player has been in the zone for 2s — trigger join
      this.entryTracking.delete(userId);
      this.triggered.add(userId);

      // Auto-clear the triggered flag after 30s to allow re-entry
      setTimeout(() => this.triggered.delete(userId), 30_000);

      this.triggerJoin(userId, socketId);
    }
  }

  /** Called when a player leaves the arena — allows them to re-enter the zone */
  clearTriggered(userId: string): void {
    this.triggered.delete(userId);
    this.entryTracking.delete(userId);
  }

  async getZoneState(): Promise<{ status: 'available' | 'locked'; activePlayers: number }> {
    const state = await this.redis.getShooterZoneState();
    return state ?? { status: 'available', activePlayers: 0 };
  }

  async lockZone(activePlayers: number): Promise<void> {
    await this.redis.setShooterZoneState({ status: 'locked', activePlayers });
    this.logger.log(`Shooter zone locked (${activePlayers} players)`);
  }

  async unlockZone(activePlayers: number): Promise<void> {
    const status = activePlayers >= MAX_PLAYERS ? 'locked' : 'available';
    await this.redis.setShooterZoneState({ status, activePlayers });
    this.logger.log(`Shooter zone state: ${status} (${activePlayers} players)`);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Expire entries where the player stopped sending events (walked away).
   * If lastSeenAt is older than 600ms (3× the 200ms emit interval), reset.
   */
  private expireStaleEntries(): void {
    const now = Date.now();
    const STALE_MS = 600;
    for (const [userId, entry] of this.entryTracking) {
      if (now - entry.lastSeenAt > STALE_MS) {
        this.entryTracking.delete(userId);
        this.logger.debug(`Zone entry expired for userId=${userId}`);
      }
    }
  }

  private triggerJoin(userId: string, socketId: string): void {
    this.logger.log(`[Zone] Player ${userId} entering arena — emitting shooterJoined`);

    if (!this.mapServer) {
      this.logger.error('[Zone] mapServer not set — cannot emit shooterJoined');
      return;
    }

    const currentState = this.engine.getRoomState();

    this.mapServer.to(socketId).emit('shooterJoined', {
      roomId: currentState.roomId,
      players: currentState.players,
    });

    if (this.onShooterJoined) {
      this.onShooterJoined(userId, socketId);
    }
  }
}
