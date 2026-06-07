import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Server } from 'socket.io';
import { InMemoryRepository } from '../virtual-world/infrastructure/persistence/in-memory/in-memory.repository';
import { CrownState, CROWN_TTL_SECONDS } from './interfaces/football-duel.interfaces';

@Injectable()
export class CrownService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrownService.name);

  /** Reference to the /map namespace server – set by DuelPadGateway after init */
  private mapServer: Server | null = null;

  /** Polling interval to detect crown expiry */
  private expiryInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly repository: InMemoryRepository) {}

  onModuleInit() {
    // Check every 10 s whether the crown has expired
    this.expiryInterval = setInterval(() => this.checkExpiry(), 10_000);
  }

  onModuleDestroy() {
    if (this.expiryInterval) clearInterval(this.expiryInterval);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  setMapServer(server: Server) {
    this.mapServer = server;
  }

  /**
   * Award the crown to a winner.
   * Replaces any existing crown (only one active at a time).
   */
  async awardCrown(winnerId: string, winnerName: string): Promise<void> {
    const expiresAt = Date.now() + CROWN_TTL_SECONDS * 1000;
    const state: CrownState = { winnerId, winnerName, expiresAt };

    await this.repository.setCrownState(state, CROWN_TTL_SECONDS);
    this.broadcastCrownUpdate(state);
    this.logger.log(`Crown awarded to ${winnerName} (${winnerId}), expires at ${new Date(expiresAt).toISOString()}`);
  }

  /** Explicitly revoke the crown (e.g. on server shutdown or admin action) */
  async revokeCrown(): Promise<void> {
    await this.repository.deleteCrownState();
    this.broadcastCrownUpdate({ winnerId: null, expiresAt: 0 });
    this.logger.log('Crown revoked');
  }

  async getCurrentCrown(): Promise<CrownState | null> {
    return this.repository.getCrownState();
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async checkExpiry(): Promise<void> {
    const crown = await this.repository.getCrownState();
    if (!crown) return; // already expired / never set

    if (Date.now() >= crown.expiresAt) {
      await this.repository.deleteCrownState();
      this.broadcastCrownUpdate({ winnerId: null, expiresAt: 0 });
      this.logger.log('Crown expired and removed');
    }
  }

  private broadcastCrownUpdate(state: CrownState): void {
    if (!this.mapServer) return;
    this.mapServer.emit('crownUpdate', state);
  }
}
