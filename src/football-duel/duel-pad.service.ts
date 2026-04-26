import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Server } from 'socket.io';
import { RedisRepository } from '../contexts/realtime/infrastructure/persistence/redis/redis.repository';
import {
  PadId,
  PadState,
  PAD_AREAS,
  AVATAR_RADIUS,
  PAD_ACTIVATION_MS,
  DuelStartedPayload,
} from './interfaces/football-duel.interfaces';

/** Injected by FootballDuelGateway after init */
export const MAP_SERVER_TOKEN = 'MAP_SERVER';

@Injectable()
export class DuelPadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuelPadService.name);

  /** Reference to the /map namespace server – set by DuelPadGateway after init */
  private mapServer: Server | null = null;

  /** Callback invoked when both pads are activated – set by DuelEngineService */
  private onDuelActivated: ((p1Id: string, p1Name: string, p2Id: string, p2Name: string) => Promise<string>) | null = null;

  /** In-memory activation progress per pad (0 – 1) */
  private activationProgress: Record<PadId, number> = { 'pad-a': 0, 'pad-b': 0 };

  /** Whether pads are currently locked (match in progress) */
  private locked = false;

  /** Occupant info kept in memory for fast access (mirrors Redis) */
  private occupants: Record<PadId, { userId: string; name: string; socketId: string } | null> = {
    'pad-a': null,
    'pad-b': null,
  };

  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  /** Timestamp of last activation-progress tick */
  private lastTickAt = 0;

  constructor(private readonly redis: RedisRepository) {}

  onModuleInit() {
    // Poll every 100 ms to check simultaneous presence and advance activation
    this.pollingInterval = setInterval(() => this.pollActivation(), 100);
  }

  onModuleDestroy() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  setMapServer(server: Server) {
    this.mapServer = server;
  }

  setDuelActivatedCallback(
    cb: (p1Id: string, p1Name: string, p2Id: string, p2Name: string) => Promise<string>,
  ) {
    this.onDuelActivated = cb;
  }

  /**
   * Geometric hit-test: circle (avatar) vs rectangle (pad).
   * Returns true when the avatar overlaps the pad area.
   */
  isInsidePad(padId: PadId, avatarX: number, avatarY: number): boolean {
    const area = PAD_AREAS[padId];
    const closestX = Math.max(area.x, Math.min(avatarX, area.x + area.width));
    const closestY = Math.max(area.y, Math.min(avatarY, area.y + area.height));
    const dx = avatarX - closestX;
    const dy = avatarY - closestY;
    return dx * dx + dy * dy <= AVATAR_RADIUS * AVATAR_RADIUS;
  }

  /**
   * Called by DuelPadGateway on every `checkDuelPads` event.
   * Returns the padId the player is standing on, or null.
   */
  async handleCheckDuelPads(
    userId: string,
    userName: string,
    socketId: string,
    x: number,
    y: number,
  ): Promise<{ padId: PadId | null; blocked: boolean }> {
    const padIds: PadId[] = ['pad-a', 'pad-b'];

    for (const padId of padIds) {
      if (!this.isInsidePad(padId, x, y)) continue;

      const state = await this.redis.getPadState(padId);

      // Reject if locked
      if (state?.status === 'locked') {
        return { padId, blocked: true };
      }

      // Reject if the same user already occupies the OTHER pad
      const otherId: PadId = padId === 'pad-a' ? 'pad-b' : 'pad-a';
      if (this.occupants[otherId]?.userId === userId) {
        return { padId: null, blocked: false };
      }

      // Register presence with 500 ms TTL
      await this.redis.setPadPresence(padId, userId, socketId);
      this.occupants[padId] = { userId, name: userName, socketId };

      // Persist pad state
      const newState: PadState = {
        padId,
        status: 'occupied',
        occupantId: userId,
        occupantName: userName,
        occupiedAt: Date.now(),
        activationProgress: this.activationProgress[padId],
      };
      await this.redis.setPadState(padId, newState);

      return { padId, blocked: false };
    }

    // Player is not on any pad – clear their occupancy if they were on one
    for (const padId of padIds) {
      if (this.occupants[padId]?.userId === userId) {
        await this.clearOccupant(padId);
      }
    }

    return { padId: null, blocked: false };
  }

  async getPadStates(): Promise<PadState[]> {
    const states: PadState[] = [];
    for (const padId of ['pad-a', 'pad-b'] as PadId[]) {
      const s = await this.redis.getPadState(padId);
      states.push(
        s ?? {
          padId,
          status: 'available',
          activationProgress: this.activationProgress[padId],
        },
      );
    }
    return states;
  }

  async lockPads(matchId: string): Promise<void> {
    this.locked = true;
    for (const padId of ['pad-a', 'pad-b'] as PadId[]) {
      const locked: PadState = {
        padId,
        status: 'locked',
        activationProgress: 1,
      };
      await this.redis.setPadState(padId, locked);
    }
    this.activationProgress['pad-a'] = 0;
    this.activationProgress['pad-b'] = 0;
    this.broadcastPadStates();
    this.logger.log(`Pads locked for match ${matchId}`);
  }

  async unlockPads(): Promise<void> {
    this.locked = false;
    for (const padId of ['pad-a', 'pad-b'] as PadId[]) {
      const available: PadState = { padId, status: 'available', activationProgress: 0 };
      await this.redis.setPadState(padId, available);
      this.occupants[padId] = null;
    }
    this.activationProgress['pad-a'] = 0;
    this.activationProgress['pad-b'] = 0;
    this.broadcastPadStates();
    this.logger.log('Pads unlocked');
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async pollActivation() {
    // Don't touch anything while a match is in progress
    if (this.locked) return;

    const now = Date.now();
    const elapsed = this.lastTickAt ? now - this.lastTickAt : 100;
    this.lastTickAt = now;

    const occA = this.occupants['pad-a'];
    const occB = this.occupants['pad-b'];

    // Verify Redis TTL hasn't expired (player may have stopped sending events)
    if (occA) {
      const presence = await this.redis.getPadPresence('pad-a', occA.userId);
      if (!presence) await this.clearOccupant('pad-a');
    }
    if (occB) {
      const presence = await this.redis.getPadPresence('pad-b', occB.userId);
      if (!presence) await this.clearOccupant('pad-b');
    }

    const bothPresent =
      this.occupants['pad-a'] !== null &&
      this.occupants['pad-b'] !== null &&
      this.occupants['pad-a']!.userId !== this.occupants['pad-b']!.userId;

    if (bothPresent) {
      // Advance progress (PAD_ACTIVATION_MS = 2000 ms)
      const delta = elapsed / PAD_ACTIVATION_MS;
      this.activationProgress['pad-a'] = Math.min(1, this.activationProgress['pad-a'] + delta);
      this.activationProgress['pad-b'] = Math.min(1, this.activationProgress['pad-b'] + delta);

      // Broadcast progress to all /map clients
      this.broadcastPadStates();

      if (
        this.activationProgress['pad-a'] >= 1 &&
        this.activationProgress['pad-b'] >= 1
      ) {
        await this.triggerDuel();
      }
    } else {
      // Reset progress if either pad is empty
      if (
        this.activationProgress['pad-a'] > 0 ||
        this.activationProgress['pad-b'] > 0
      ) {
        this.activationProgress['pad-a'] = 0;
        this.activationProgress['pad-b'] = 0;
        this.broadcastPadStates();
      }
    }
  }

  private async triggerDuel() {
    const p1 = this.occupants['pad-a']!;
    const p2 = this.occupants['pad-b']!;

    this.logger.log(`Duel triggered: ${p1.userId} vs ${p2.userId}`);

    if (!this.onDuelActivated) {
      this.logger.error('onDuelActivated callback not set');
      return;
    }

    const matchId = await this.onDuelActivated(p1.userId, p1.name, p2.userId, p2.name);
    await this.lockPads(matchId);

    const payload: DuelStartedPayload = {
      matchId,
      player1: { userId: p1.userId, name: p1.name },
      player2: { userId: p2.userId, name: p2.name },
    };

    // Emit duelStarted to both players via the /map server
    if (this.mapServer) {
      this.mapServer.to(p1.socketId).emit('duelStarted', payload);
      this.mapServer.to(p2.socketId).emit('duelStarted', payload);
    }
  }

  private async clearOccupant(padId: PadId) {
    const occ = this.occupants[padId];
    if (occ) {
      await this.redis.deletePadPresence(padId, occ.userId);
    }
    this.occupants[padId] = null;
    const state: PadState = { padId, status: 'available', activationProgress: 0 };
    await this.redis.setPadState(padId, state);
  }

  private broadcastPadStates() {
    if (!this.mapServer) return;
    const states: PadState[] = (['pad-a', 'pad-b'] as PadId[]).map((padId) => {
      if (this.locked) {
        return { padId, status: 'locked' as PadStatus, activationProgress: 0 };
      }
      return {
        padId,
        status: this.occupants[padId] ? ('occupied' as PadStatus) : ('available' as PadStatus),
        occupantId: this.occupants[padId]?.userId,
        occupantName: this.occupants[padId]?.name,
        activationProgress: this.activationProgress[padId],
      };
    });
    this.mapServer.emit('padStateUpdate', states);
  }
}

// local type alias to avoid import cycle
type PadStatus = 'available' | 'occupied' | 'locked';
