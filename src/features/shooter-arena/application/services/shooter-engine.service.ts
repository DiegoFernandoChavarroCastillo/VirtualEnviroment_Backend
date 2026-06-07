import { Injectable, Logger, OnModuleDestroy, Inject } from '@nestjs/common';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { CollisionService } from './collision.service';
import { SpatialHashGrid } from '../../infrastructure/utils/spatial-hash';
import { projectilePool, PooledProjectile } from '../../infrastructure/persistence/object-pool';
import {
  ShooterPlayerState,
  ShooterSnapshot,
  ShooterInput,
  Projectile,
  ShooterRoomState,
  PlayerHitPayload,
  PlayerEliminatedPayload,
  PlayerLeftPayload,
  ReturnPayload,
  RocketExplosionPayload,
  ShieldAbsorbedPayload,
  CoverStructure,
  MAX_PLAYERS,
  ROOM_ID,
  PLAYER_RADIUS,
  PROJECTILE_RADIUS,
} from '../../domain/entities/shooter-arena.types';
import { COVER_STRUCTURES } from '../../domain/config/cover-structures';
import { GameConfigPort, GAME_CONFIG_PORT } from '../../domain/ports/game-config.port';

interface QueuedInput {
  userId: string;
  input: ShooterInput;
}

interface RoomInstance {
  roomId: string;
  players: Map<string, ShooterPlayerState & { socketId: string }>;
  projectiles: Map<string, PooledProjectile>;
  tick: number;
  shotTimestamps: Map<string, number[]>;
  shotgunTimestamps: Map<string, number[]>;
  reconnecting: Map<string, { expiresAt: number; state: ShooterPlayerState & { socketId: string } }>;
  gameLoopInterval: ReturnType<typeof setInterval> | null;
  joinTimestamps: Map<string, number>;
  badgesAwarded: Map<string, Set<string>>;
}

@Injectable()
export class ShooterEngineService implements OnModuleDestroy {
  private readonly logger = new Logger(ShooterEngineService.name);

  private server: Server | null = null;

  private room: RoomInstance = this.createEmptyRoom();

  private onPlayerEliminated: ((userId: string) => void) | null = null;

  private readonly inputQueue: QueuedInput[] = [];

  private readonly playerGrid = new SpatialHashGrid<ShooterPlayerState & { socketId: string; id: string }>(80);
  private readonly queryBuf: Array<ShooterPlayerState & { socketId: string; id: string }> = [];
  private readonly querySeen = new Set<string>();

  private snapshotPlayersBuf: ShooterPlayerState[] = [];
  private snapshotProjsBuf: Projectile[] = [];

  private readonly toRemoveIds: string[] = [];

  private readonly config: ReturnType<GameConfigPort['getArenaConfig']>;
  private readonly shieldConfig: ReturnType<GameConfigPort['getItem']>;
  private readonly weapons: Record<string, ReturnType<GameConfigPort['getWeapon']>>;

  constructor(
    private readonly collision: CollisionService,
    @Inject(GAME_CONFIG_PORT) private readonly gameConfig: GameConfigPort,
  ) {
    this.config = this.gameConfig.getArenaConfig();
    this.shieldConfig = this.gameConfig.getItem('shield')!;
    this.weapons = this.gameConfig.getAllWeapons();
  }

  setOnPlayerEliminatedCallback(cb: (userId: string) => void): void {
    this.onPlayerEliminated = cb;
  }

  onModuleDestroy() {
    this.stopGameLoop();
  }

  setServer(server: Server) {
    this.server = server;
  }

  addPlayer(userId: string, name: string, socketId: string): void {
    const reconnEntry = this.room.reconnecting.get(userId);
    if (reconnEntry && Date.now() < reconnEntry.expiresAt && reconnEntry.state.lives > 0) {
      const restored = { ...reconnEntry.state, socketId };
      this.room.players.set(userId, restored);
      this.room.reconnecting.delete(userId);
      this.logger.log(`[Engine] Player ${userId} reconnected`);
    } else {
      this.room.reconnecting.delete(userId);
      const occupiedPositions = Array.from(this.room.players.values()).map(p => ({ x: p.x, y: p.y }));
      const spawn = this.collision.generateRespawnPosition(
        { width: this.config.arena.width, height: this.config.arena.height },
        COVER_STRUCTURES,
        occupiedPositions,
      );
      const player: ShooterPlayerState & { socketId: string } = {
        userId,
        name,
        lives: this.config.player.maxLives,
        kills: 0,
        deaths: 0,
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        socketId,
      };
      this.room.players.set(userId, player);
      this.logger.log(`[Engine] Player ${name} joined at (${spawn.x}, ${spawn.y})`);
    }

    this.room.joinTimestamps.set(userId, Date.now());
    if (!this.room.badgesAwarded.has(userId)) {
      this.room.badgesAwarded.set(userId, new Set());
    }

    if (!this.room.gameLoopInterval && this.room.players.size > 0) {
      this.startGameLoop();
    }
  }

  removePlayer(userId: string): void {
    const player = this.room.players.get(userId);
    if (!player) return;

    this.room.players.delete(userId);
    this.room.shotTimestamps.delete(userId);
    this.room.shotgunTimestamps.delete(userId);
    this.room.joinTimestamps.delete(userId);

    const activePlayers = this.room.players.size;

    const payload: PlayerLeftPayload = { userId, activePlayers };
    this.server?.to(ROOM_ID).emit('playerLeft', payload);

    const returnPayload: ReturnPayload = this.generateVirtualWorldSpawn();
    this.server?.to(player.socketId).emit('returnToVirtualWorld', returnPayload);

    this.logger.log(`Player ${userId} left room. Active: ${activePlayers}`);

    if (activePlayers === 0) {
      this.stopGameLoop();
    }
  }

  markDisconnected(userId: string): void {
    const player = this.room.players.get(userId);
    if (!player) return;

    if (player.lives > 0) {
      this.room.reconnecting.set(userId, {
        expiresAt: Date.now() + 10_000,
        state: { ...player },
      });
    }

    this.room.players.delete(userId);
    this.room.shotTimestamps.delete(userId);
    this.room.shotgunTimestamps.delete(userId);

    if (this.room.players.size === 0) {
      this.stopGameLoop();
    }
  }

  handlePlayerInput(userId: string, input: ShooterInput): void {
    this.inputQueue.push({ userId, input });
  }

  getRoomState(): ShooterRoomState {
    return {
      roomId: ROOM_ID,
      players: Array.from(this.room.players.values()).map(({ socketId: _s, ...p }) => p),
      structures: COVER_STRUCTURES,
      status: this.room.players.size > 0 ? 'active' : 'waiting',
      updatedAt: Date.now(),
    };
  }

  getActivePlayers(): number {
    return this.room.players.size;
  }

  private startGameLoop() {
    if (this.room.gameLoopInterval) return;
    const tickMs = 1000 / this.config.gameplay.tickRate;
    this.room.gameLoopInterval = setInterval(() => this.tick(), tickMs);
    this.logger.log('🚀 Game loop STARTED');
  }

  private stopGameLoop() {
    if (this.room.gameLoopInterval) {
      clearInterval(this.room.gameLoopInterval);
      this.room.gameLoopInterval = null;
      this.logger.log('Game loop paused (no players)');
    }
  }

  private tick() {
    this.room.tick++;

    this.processInputQueue();
    this.updatePlayers();
    this.updateProjectiles();
    this.checkLastStanding();
    this.checkSurvivalRewards();
    this.emitSnapshot();
  }

  private processInputQueue(): void {
    const len = this.inputQueue.length;
    if (len === 0) return;

    for (let i = 0; i < len; i++) {
      const { userId, input } = this.inputQueue[i];
      const player = this.room.players.get(userId);
      if (!player) continue;

      if (input.action === 'move') {
        const dx = input.dx ?? 0;
        const dy = input.dy ?? 0;
        player.vx = dx * this.config.player.speed;
        player.vy = dy * this.config.player.speed;
      } else if (input.action === 'shoot') {
        const weaponType = input.weaponType ?? 'normal';
        this.createProjectile(
          userId,
          input.aimDx ?? input.dx ?? 0,
          input.aimDy ?? input.dy ?? 0,
          weaponType,
        );
      } else if (input.action === 'activateShield') {
        if (!player.shielded) {
          player.shielded = true;
          player.shieldExpiresAt = Date.now() + (this.shieldConfig?.durationMs ?? 8000);
          this.logger.debug(`[Shield] Player ${userId} activated shield`);
        }
      }
    }
    this.inputQueue.length = 0;
  }

  private updatePlayers(): void {
    const now = Date.now();
    for (const player of this.room.players.values()) {
      if (player.shielded && player.shieldExpiresAt && now >= player.shieldExpiresAt) {
        player.shielded = false;
        player.shieldExpiresAt = undefined;
        this.logger.debug(`[Shield] Player ${player.userId} shield expired`);
      }

      const speed = player.vx * player.vx + player.vy * player.vy;
      if (speed > this.config.gameplay.maxSpeedViolation * this.config.gameplay.maxSpeedViolation) {
        player.vx = 0;
        player.vy = 0;
      }

      player.x += player.vx;
      player.y += player.vy;

      this.collision.clampPositionInPlace(player, this.config.arena.width, this.config.arena.height, 20);

      for (let i = 0, sLen = COVER_STRUCTURES.length; i < sLen; i++) {
        this.collision.resolvePlayerStructureCollisionInPlace(player, COVER_STRUCTURES[i]);
      }
    }
  }

  private updateProjectiles(): void {
    this.toRemoveIds.length = 0;

    this.playerGrid.clear();
    for (const player of this.room.players.values()) {
      (player as any).id = player.userId;
      this.playerGrid.insert(player as any, PLAYER_RADIUS);
    }

    for (const [projId, proj] of this.room.projectiles) {
      proj.x += proj.vx;
      proj.y += proj.vy;

      if (proj.x - PROJECTILE_RADIUS <= 0 || proj.x + PROJECTILE_RADIUS >= this.config.arena.width ||
          proj.y - PROJECTILE_RADIUS <= 0 || proj.y + PROJECTILE_RADIUS >= this.config.arena.height) {
        if (proj.weaponType === 'rocket') {
          this.triggerRocketExplosion(proj.x, proj.y, proj.ownerId);
        }
        this.toRemoveIds.push(projId);
        continue;
      }

      let hitStructure = false;
      for (let i = 0, sLen = COVER_STRUCTURES.length; i < sLen; i++) {
        if (this.collision.checkProjectileStructureCollision(proj, COVER_STRUCTURES[i])) {
          hitStructure = true;
          break;
        }
      }
      if (hitStructure) {
        if (proj.weaponType === 'rocket') {
          this.triggerRocketExplosion(proj.x, proj.y, proj.ownerId);
        }
        this.toRemoveIds.push(projId);
        continue;
      }

      const queryRadius = PROJECTILE_RADIUS + PLAYER_RADIUS;
      this.playerGrid.query(proj.x, proj.y, queryRadius, this.queryBuf, this.querySeen);
      let hitPlayer = false;
      for (let i = 0, qLen = this.queryBuf.length; i < qLen; i++) {
        const candidate = this.queryBuf[i];
        if (proj.ownerId === candidate.userId) continue;
        const dx = proj.x - candidate.x;
        const dy = proj.y - candidate.y;
        if (dx * dx + dy * dy <= queryRadius * queryRadius) {
          this.toRemoveIds.push(projId);
          if (proj.weaponType === 'rocket') {
            this.triggerRocketExplosion(proj.x, proj.y, proj.ownerId);
          } else {
            this.applyHit(candidate as ShooterPlayerState & { socketId: string }, proj.ownerId);
          }
          hitPlayer = true;
          break;
        }
      }
      if (hitPlayer) continue;
    }

    for (let i = 0, rLen = this.toRemoveIds.length; i < rLen; i++) {
      const id = this.toRemoveIds[i];
      const proj = this.room.projectiles.get(id);
      if (proj) {
        proj.active = false;
        projectilePool.release(proj);
        this.room.projectiles.delete(id);
      }
    }
  }

  private triggerRocketExplosion(x: number, y: number, ownerId: string): void {
    const rocketCfg = this.weapons['rocket'];
    const explosionRadius = rocketCfg?.explosionRadius ?? 120;

    const explosionPayload: RocketExplosionPayload = { x, y, radius: explosionRadius };
    this.server?.to(ROOM_ID).emit('rocketExplosion', explosionPayload);

    const aoeQueryBuf: Array<ShooterPlayerState & { socketId: string; id: string }> = [];
    const aoeSeen = new Set<string>();
    this.playerGrid.query(x, y, explosionRadius + PLAYER_RADIUS, aoeQueryBuf, aoeSeen);

    for (const candidate of aoeQueryBuf) {
      const dx = x - candidate.x;
      const dy = y - candidate.y;
      const distSq = dx * dx + dy * dy;
      const threshold = explosionRadius + PLAYER_RADIUS;
      if (distSq <= threshold * threshold) {
        this.applyHit(candidate as ShooterPlayerState & { socketId: string }, ownerId);
      }
    }
  }

  private checkLastStanding(): void {
    if (this.room.players.size <= 1) return;
    let aliveCount = 0;
    let lastAliveId = '';
    for (const p of this.room.players.values()) {
      if (p.lives > 0) {
        aliveCount++;
        lastAliveId = p.userId;
        if (aliveCount > 1) return;
      }
    }
    if (aliveCount === 1) {
      this.server?.to(ROOM_ID).emit('lastPlayerStanding', { userId: lastAliveId });
    }
  }

  private applyHit(victim: ShooterPlayerState & { socketId: string }, attackerId: string) {
    if (victim.shielded) {
      victim.shielded = false;
      victim.shieldExpiresAt = undefined;
      const absorbPayload: ShieldAbsorbedPayload = { victimId: victim.userId };
      this.server?.to(ROOM_ID).emit('shieldAbsorbed', absorbPayload);
      this.logger.debug(`[Shield] Player ${victim.userId} shield absorbed a hit`);
      return;
    }

    victim.lives = Math.max(0, victim.lives - 1);

    const hitPayload: PlayerHitPayload = {
      victimId: victim.userId,
      attackerId,
      livesRemaining: victim.lives,
    };
    this.server?.to(ROOM_ID).emit('playerHit', hitPayload);

    if (victim.lives === 0) {
      victim.deaths++;

      const attacker = this.room.players.get(attackerId);
      if (attacker) attacker.kills++;

      const elimPayload: PlayerEliminatedPayload = {
        eliminatedId: victim.userId,
        killerId: attackerId,
      };
      this.server?.to(ROOM_ID).emit('playerEliminated', elimPayload);

      this.emitXpEvent(attackerId, 'kill', this.config.xp.perKill);

      if (attacker && attacker.kills >= this.config.badges.killsThreshold) {
        this.emitBadgeEvent(attackerId, 'tirador-del-campus');
      }

      const returnPayload: ReturnPayload = this.generateVirtualWorldSpawn();
      this.server?.to(victim.socketId).emit('returnToVirtualWorld', returnPayload);

      this.room.players.delete(victim.userId);
      this.room.shotTimestamps.delete(victim.userId);
      this.room.shotgunTimestamps.delete(victim.userId);
      this.room.joinTimestamps.delete(victim.userId);
      this.room.reconnecting.delete(victim.userId);

      this.onPlayerEliminated?.(victim.userId);

      if (this.room.players.size === 0) this.stopGameLoop();
    } else {
      const spawn = this.collision.generateRespawnPosition({ width: this.config.arena.width, height: this.config.arena.height });
      victim.x = spawn.x;
      victim.y = spawn.y;
      victim.vx = 0;
      victim.vy = 0;
    }
  }

  private createProjectile(
    userId: string,
    dx: number,
    dy: number,
    weaponType: 'normal' | 'shotgun' | 'rocket' = 'normal',
  ): void {
    const now = Date.now();
    const player = this.room.players.get(userId);
    if (!player) return;

    const len = Math.sqrt(dx * dx + dy * dy);
    const ndx = len > 0 ? dx / len : 1;
    const ndy = len > 0 ? dy / len : 0;

    if (weaponType === 'shotgun') {
      const shotgunCfg = this.weapons['shotgun'];
      const pellets = shotgunCfg?.pellets ?? 3;
      const spread = shotgunCfg?.spread ?? 0.25;
      const fireRate = shotgunCfg?.fireRate ?? 1;
      const projSpeed = shotgunCfg?.speed ?? this.config.projectile.radius * 2;

      const shotgunTs = this.room.shotgunTimestamps.get(userId) ?? [];
      const recentShotgun = shotgunTs.filter(t => now - t < 1000);
      if (recentShotgun.length >= fireRate) return;
      recentShotgun.push(now);
      this.room.shotgunTimestamps.set(userId, recentShotgun);

      const baseAngle = Math.atan2(ndy, ndx);
      const spreadAngles = [-spread, 0, spread];
      for (const spreadOffset of spreadAngles) {
        const angle = baseAngle + spreadOffset;
        const proj = projectilePool.acquire();
        proj.id = uuidv4();
        proj.ownerId = userId;
        proj.x = player.x;
        proj.y = player.y;
        proj.vx = Math.cos(angle) * projSpeed;
        proj.vy = Math.sin(angle) * projSpeed;
        proj.weaponType = 'shotgun';
        proj.active = true;
        this.room.projectiles.set(proj.id, proj);
      }
      return;
    }

    const normalCfg = this.weapons['normal'];
    const rocketCfg = this.weapons['rocket'];
    const fireRateLimit = this.config.gameplay.fireRateLimit;
    const normalSpeed = normalCfg?.speed ?? 8;
    const rocketSpeed = rocketCfg?.speed ?? 5;

    const timestamps = this.room.shotTimestamps.get(userId) ?? [];
    const recent = timestamps.filter(t => now - t < 1000);
    if (recent.length >= fireRateLimit) return;
    recent.push(now);
    this.room.shotTimestamps.set(userId, recent);

    const speed = weaponType === 'rocket' ? rocketSpeed : normalSpeed;

    const proj = projectilePool.acquire();
    proj.id = uuidv4();
    proj.ownerId = userId;
    proj.x = player.x;
    proj.y = player.y;
    proj.vx = ndx * speed;
    proj.vy = ndy * speed;
    proj.weaponType = weaponType;
    proj.active = true;

    this.room.projectiles.set(proj.id, proj);
  }

  private emitSnapshot() {
    if (!this.server) return;

    this.snapshotPlayersBuf.length = 0;
    for (const { socketId: _s, ...p } of this.room.players.values()) {
      this.snapshotPlayersBuf.push(p as ShooterPlayerState);
    }

    this.snapshotProjsBuf.length = 0;
    for (const proj of this.room.projectiles.values()) {
      this.snapshotProjsBuf.push({ 
        id: proj.id, 
        ownerId: proj.ownerId, 
        x: proj.x, 
        y: proj.y, 
        vx: proj.vx, 
        vy: proj.vy,
        weaponType: proj.weaponType
      });
    }

    const snapshot: ShooterSnapshot = {
      roomId: ROOM_ID,
      tick: this.room.tick,
      timestamp: Date.now(),
      players: this.snapshotPlayersBuf,
      projectiles: this.snapshotProjsBuf,
      structures: this.room.tick === 1 ? COVER_STRUCTURES : undefined,
    };

    this.server.to(ROOM_ID).emit('snapshot', snapshot);
  }

  private createEmptyRoom(): RoomInstance {
    return {
      roomId: ROOM_ID,
      players: new Map(),
      projectiles: new Map(),
      tick: 0,
      shotTimestamps: new Map(),
      shotgunTimestamps: new Map(),
      reconnecting: new Map(),
      gameLoopInterval: null,
      joinTimestamps: new Map(),
      badgesAwarded: new Map(),
    };
  }

  private emitXpEvent(userId: string, reason: string, amount: number): void {
    this.logger.log(`[XP] userId=${userId} reason=${reason} amount=${amount}`);
    this.server?.serverSideEmit?.('xp:award', { userId, reason, amount });
  }

  private emitBadgeEvent(userId: string, badge: string): void {
    const awarded = this.room.badgesAwarded.get(userId);
    if (!awarded || awarded.has(badge)) return;
    awarded.add(badge);
    this.logger.log(`[Badge] userId=${userId} badge=${badge}`);
    this.server?.serverSideEmit?.('badge:award', { userId, badge });
  }

  private checkSurvivalRewards(): void {
    if (this.room.tick % 30 !== 0) return;

    const now = Date.now();
    for (const [userId, joinTime] of this.room.joinTimestamps) {
      const elapsed = now - joinTime;
      const badges = this.room.badgesAwarded.get(userId) ?? new Set<string>();

      if (elapsed >= this.config.xp.survivalMs && !badges.has('xp:survival-5min')) {
        badges.add('xp:survival-5min');
        this.room.badgesAwarded.set(userId, badges);
        this.emitXpEvent(userId, 'survival-5min', this.config.xp.survival5min);
      }

      if (elapsed >= this.config.badges.survivalMs) {
        this.emitBadgeEvent(userId, 'sobreviviente');
      }
    }
  }

  private generateVirtualWorldSpawn(): ReturnPayload {
    const WORLD_W = 1600;
    const WORLD_H = 1200;
    const MARGIN = 80;

    const blocked = [
      { x: 560, y: 480, w: 380, h: 240 },
      { x: 1140, y: 480, w: 270, h: 270 },
    ];

    const isBlocked = (x: number, y: number) =>
      blocked.some(z => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h);

    for (let attempt = 0; attempt < 50; attempt++) {
      const x = Math.floor(Math.random() * (WORLD_W - MARGIN * 2) + MARGIN);
      const y = Math.floor(Math.random() * (WORLD_H - MARGIN * 2) + MARGIN);
      if (!isBlocked(x, y)) {
        return { spawnX: x, spawnY: y };
      }
    }

    return { spawnX: 300, spawnY: 300 };
  }
}
