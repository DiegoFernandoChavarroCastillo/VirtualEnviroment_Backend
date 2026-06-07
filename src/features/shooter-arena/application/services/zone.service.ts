import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { Server } from 'socket.io';
import { ShooterEngineService } from './shooter-engine.service';
import { Vec2, MAX_PLAYERS } from '../../domain/entities/shooter-arena.types';
import { GameConfigPort, GAME_CONFIG_PORT } from '../../domain/ports/game-config.port';

@Injectable()
export class ZoneService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZoneService.name);

  /** In-memory zone state — owned by this single instance */
  private zoneState: { status: 'available' | 'locked'; activePlayers: number } = {
    status: 'available',
    activePlayers: 0,
  };

  /**
   * Reference to the /map namespace server.
   * shooterJoined must be emitted on /map because the client socket that
   * sends checkShooterZone is connected to /map, not /shooter-arena.
   */
  private mapServer: Server | null = null;

  /** Callback invoked when a player successfully enters the zone */
  private onShooterJoined: ((userId: string, socketId: string) => void) | null = null;

  /**
   * Per-user entry tracking: { firstSeenAt, lastSeenAt }
   * Wall-clock time measures the 2s dwell window reliably,
   * independent of polling intervals or emit frequency.
   */
  private entryTracking = new Map<string, { firstSeenAt: number; lastSeenAt: number; socketId: string }>();

  /** Players that have already been triggered (prevent double-join) */
  private triggered = new Set<string>();

  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private readonly zoneRect: { x: number; y: number; width: number; height: number };
  private readonly zoneEntryMs: number;

  constructor(
    @Inject(forwardRef(() => ShooterEngineService))
    private readonly engine: ShooterEngineService,
    @Inject(GAME_CONFIG_PORT) private readonly gameConfig: GameConfigPort,
  ) {
    this.zoneRect = this.gameConfig.getArenaConfig().shooterZone.rect;
    this.zoneEntryMs = this.gameConfig.getArenaConfig().gameplay.zoneEntryMs;
  }

  onModuleInit() {
    // Poll every 100 ms to expire stale entries (player walked away without sending an event)
    this.pollingInterval = setInterval(() => this.expireStaleEntries(), 100);
    this.logger.log('[Zone] Zone state initialized (in-memory)');
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

    if (!this.isInsideZone({ x, y }, this.zoneRect)) {
      this.entryTracking.delete(userId);
      return;
    }

    // Check if zone is locked (full)
    if (this.zoneState.status === 'locked') {
      const mapSrv = this.mapServer ?? server;
      mapSrv.to(socketId).emit('zoneBlocked', { reason: 'Room is full' });
      return;
    }

    const now = Date.now();
    const existing = this.entryTracking.get(userId);

    if (!existing) {
      this.entryTracking.set(userId, { firstSeenAt: now, lastSeenAt: now, socketId });
      return;
    }

    // Update last seen and socketId (may change on reconnect)
    existing.lastSeenAt = now;
    existing.socketId = socketId;

    const dwellMs = now - existing.firstSeenAt;

    if (dwellMs >= this.zoneEntryMs) {
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

  getZoneState(): { status: 'available' | 'locked'; activePlayers: number } {
    return { ...this.zoneState };
  }

  lockZone(activePlayers: number): void {
    this.zoneState = { status: 'locked', activePlayers };
    this.logger.log(`Shooter zone locked (${activePlayers} players)`);
    this.broadcastZoneState();
  }

  unlockZone(activePlayers: number): void {
    const status = activePlayers >= MAX_PLAYERS ? 'locked' : 'available';
    this.zoneState = { status, activePlayers };
    this.logger.log(`Shooter zone state: ${status} (${activePlayers} players)`);
    this.broadcastZoneState();
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Broadcast the current zone state to all clients on the /map namespace.
   * This is how VirtualWorld.tsx gets the live activePlayers count for the
   * zone label — the /map socket is the only one those clients are connected to.
   */
  private broadcastZoneState(): void {
    if (!this.mapServer) return;
    this.mapServer.emit('roomState', {
      activePlayers: this.zoneState.activePlayers,
      players: [],  // VirtualWorld only needs the count, not the full player list
    });
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
