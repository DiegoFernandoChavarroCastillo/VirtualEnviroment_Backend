import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Server } from 'socket.io';
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

  /** Occupant info kept in memory for fast access */
  private occupants: Record<PadId, { userId: string; name: string; socketId: string } | null> = {
    'pad-a': null,
    'pad-b': null,
  };

  /** Last presence timestamp per pad per user (for TTL check) */
  private presenceTimestamps: Record<PadId, Map<string, number>> = {
    'pad-a': new Map(),
    'pad-b': new Map(),
  };

  /** Presence TTL in milliseconds */
  private readonly PRESENCE_TTL_MS = 1000;

  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.logger.log('✅ DuelPadService initialized (Redis-free, in-memory only)');
  }

  onModuleInit() {
    // Poll every 200 ms (reduced from 100ms to lower CPU load)
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
   * 
   * NOW REDIS-FREE: All state is kept in memory for maximum performance.
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
      const isInside = this.isInsidePad(padId, x, y);
      
      if (!isInside) continue;

      this.logger.log(`✅ User ${userId} (${userName}) is inside ${padId} at (${x}, ${y})`);

      // Reject if locked (match in progress)
      if (this.locked) {
        this.logger.warn(`❌ ${padId} is locked — rejecting ${userId}`);
        return { padId, blocked: true };
      }

      // Reject if the same user already occupies the OTHER pad
      const otherId: PadId = padId === 'pad-a' ? 'pad-b' : 'pad-a';
      if (this.occupants[otherId]?.userId === userId) {
        this.logger.warn(`❌ User ${userId} already occupies ${otherId} — cannot occupy both pads`);
        return { padId: null, blocked: false };
      }

      // Register presence with timestamp (in-memory TTL)
      this.presenceTimestamps[padId].set(userId, Date.now());
      this.occupants[padId] = { userId, name: userName, socketId };

      this.logger.log(`📍 Registered ${userId} on ${padId} — occupants: A=${this.occupants['pad-a']?.userId ?? 'empty'} B=${this.occupants['pad-b']?.userId ?? 'empty'}`);

      return { padId, blocked: false };
    }

    // Player is not on any pad – clear their occupancy if they were on one
    for (const padId of padIds) {
      if (this.occupants[padId]?.userId === userId) {
        this.clearOccupant(padId);
      }
    }

    return { padId: null, blocked: false };
  }

  async getPadStates(): Promise<PadState[]> {
    const states: PadState[] = [];
    for (const padId of ['pad-a', 'pad-b'] as PadId[]) {
      // Build state from in-memory data
      if (this.locked) {
        states.push({
          padId,
          status: 'locked',
          activationProgress: 1,
        });
      } else if (this.occupants[padId]) {
        states.push({
          padId,
          status: 'occupied',
          occupantId: this.occupants[padId]!.userId,
          occupantName: this.occupants[padId]!.name,
          occupiedAt: Date.now(),
          activationProgress: this.activationProgress[padId],
        });
      } else {
        states.push({
          padId,
          status: 'available',
          activationProgress: this.activationProgress[padId],
        });
      }
    }
    return states;
  }

  async lockPads(matchId: string): Promise<void> {
    this.locked = true;
    // No Redis - state is only in memory
    this.activationProgress['pad-a'] = 0;
    this.activationProgress['pad-b'] = 0;
    this.broadcastPadStates();
    this.logger.log(`Pads locked for match ${matchId} (in-memory only)`);
  }

  async unlockPads(): Promise<void> {
    this.locked = false;
    // Clear in-memory state
    this.occupants['pad-a'] = null;
    this.occupants['pad-b'] = null;
    this.presenceTimestamps['pad-a'].clear();
    this.presenceTimestamps['pad-b'].clear();
    this.activationProgress['pad-a'] = 0;
    this.activationProgress['pad-b'] = 0;
    this.broadcastPadStates();
    this.logger.log('Pads unlocked (in-memory only)');
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async pollActivation() {
    // Don't touch anything while a match is in progress
    if (this.locked) return;

    const occA = this.occupants['pad-a'];
    const occB = this.occupants['pad-b'];

    // Check in-memory TTL for presence (no Redis calls!)
    const now = Date.now();
    
    if (occA) {
      const lastPresence = this.presenceTimestamps['pad-a'].get(occA.userId);
      if (!lastPresence || now - lastPresence > this.PRESENCE_TTL_MS) {
        this.logger.log(`Pad A occupant ${occA.userId} presence expired — clearing`);
        this.clearOccupant('pad-a');
      }
    }
    
    if (occB) {
      const lastPresence = this.presenceTimestamps['pad-b'].get(occB.userId);
      if (!lastPresence || now - lastPresence > this.PRESENCE_TTL_MS) {
        this.logger.log(`Pad B occupant ${occB.userId} presence expired — clearing`);
        this.clearOccupant('pad-b');
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

  private clearOccupant(padId: PadId) {
    const occ = this.occupants[padId];
    if (occ) {
      this.presenceTimestamps[padId].delete(occ.userId);
    }
    this.occupants[padId] = null;
    // No Redis - state is only in memory
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
