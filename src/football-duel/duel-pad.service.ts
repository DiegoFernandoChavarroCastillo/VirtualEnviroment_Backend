import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Server } from 'socket.io';
import { RedisRepository } from '../contexts/realtime/infrastructure/persistence/redis/redis.repository';
import {
  PadId,
  PadState,
  PAD_AREAS,
  AVATAR_RADIUS,
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

  constructor(private readonly redis: RedisRepository) {}

  onModuleInit() {
    // Poll every 200 ms (reduced from 100ms to lower Redis load)
    // This is still responsive enough for pad activation
    this.pollingInterval = setInterval(() => this.pollActivation(), 200);
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
    const distance = Math.sqrt(dx * dx + dy * dy);
    const isInside = distance <= AVATAR_RADIUS;
    
    // Log detallado para debug
    if (avatarX > 250 && avatarX < 550 && avatarY > 450) {
      this.logger.log(
        `isInsidePad(${padId}): avatar=(${avatarX.toFixed(1)}, ${avatarY.toFixed(1)}) ` +
        `area=(${area.x}-${area.x + area.width}, ${area.y}-${area.y + area.height}) ` +
        `closest=(${closestX.toFixed(1)}, ${closestY.toFixed(1)}) ` +
        `distance=${distance.toFixed(1)} radius=${AVATAR_RADIUS} ` +
        `isInside=${isInside}`
      );
    }
    
    return isInside;
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

    // Log TODAS las coordenadas para debug
    //this.logger.log(`🔍 checkDuelPads: user=${userName} pos=(${x.toFixed(1)}, ${y.toFixed(1)})`);

    for (const padId of padIds) {
      const isInside = this.isInsidePad(padId, x, y);
      
      if (!isInside) continue;

      this.logger.log(`✅ User ${userId} (${userName}) is inside ${padId} at (${x}, ${y})`);

      const state = await this.redis.getPadState(padId);

      // Reject if locked
      if (state?.status === 'locked') {
        this.logger.warn(`❌ ${padId} is locked — rejecting ${userId}`);
        return { padId, blocked: true };
      }

      // Reject if the same user already occupies the OTHER pad
      const otherId: PadId = padId === 'pad-a' ? 'pad-b' : 'pad-a';
      if (this.occupants[otherId]?.userId === userId) {
        this.logger.warn(`❌ User ${userId} already occupies ${otherId} — cannot occupy both pads`);
        return { padId: null, blocked: false };
      }

      // Register presence with 1000 ms TTL (reduced from 2000ms for faster cleanup)
      // Client sends checkDuelPads every ~100ms, so 1000ms TTL is safe
      await this.redis.setPadPresence(padId, userId, socketId);
      this.occupants[padId] = { userId, name: userName, socketId };

      this.logger.log(`📍 Registered ${userId} on ${padId} — occupants: A=${this.occupants['pad-a']?.userId ?? 'empty'} B=${this.occupants['pad-b']?.userId ?? 'empty'}`);

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

    const occA = this.occupants['pad-a'];
    const occB = this.occupants['pad-b'];

    // Batch Redis checks: only verify presence if we have occupants
    // This reduces Redis calls from 2 per poll to 0-2 per poll
    if (occA || occB) {
      const [presenceA, presenceB] = await Promise.all([
        occA ? this.redis.getPadPresence('pad-a', occA.userId) : Promise.resolve(null),
        occB ? this.redis.getPadPresence('pad-b', occB.userId) : Promise.resolve(null),
      ]);

      // Clear expired occupants
      if (occA && !presenceA) {
        this.logger.log(`Pad A occupant ${occA.userId} presence expired — clearing`);
        await this.clearOccupant('pad-a');
      }
      if (occB && !presenceB) {
        this.logger.log(`Pad B occupant ${occB.userId} presence expired — clearing`);
        await this.clearOccupant('pad-b');
      }
    }

    const bothPresent =
      this.occupants['pad-a'] !== null &&
      this.occupants['pad-b'] !== null &&
      this.occupants['pad-a']!.userId !== this.occupants['pad-b']!.userId;

    if (bothPresent) {
      // Both pads occupied — trigger duel immediately
      this.activationProgress['pad-a'] = 1;
      this.activationProgress['pad-b'] = 1;
      this.broadcastPadStates();
      this.logger.log('🎮 Both pads occupied — triggering duel immediately');
      this.locked = true; // lock immediately to prevent re-entry on next poll tick
      await this.triggerDuel();
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
