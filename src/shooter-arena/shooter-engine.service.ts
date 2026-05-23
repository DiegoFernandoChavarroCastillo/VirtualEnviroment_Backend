import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { CollisionService } from './collision.service';
import { SpatialHashGrid } from './spatial-hash';
import { projectilePool, PooledProjectile } from './object-pool';
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
  CoverStructure,
  COVER_STRUCTURES,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  PLAYER_SPEED,
  PROJECTILE_SPEED,
  INITIAL_LIVES,
  MAX_PLAYERS,
  FIRE_RATE_LIMIT,
  TICK_MS,
  MAX_SPEED_VIOLATION,
  ROOM_ID,
  PLAYER_RADIUS,
  PROJECTILE_RADIUS,
} from './interfaces/shooter-arena.interfaces';

/** XP otorgado por kill */
const XP_PER_KILL = 50;
/** XP otorgado por supervivencia de 5 minutos */
const XP_SURVIVAL_5MIN = 100;
/** Kills necesarios para el badge "Tirador del Campus" */
const BADGE_KILLS_THRESHOLD = 5;
/** Tiempo de supervivencia para badge "Sobreviviente" (ms) */
const BADGE_SURVIVAL_MS = 10 * 60 * 1000; // 10 minutos
/** Tiempo de supervivencia para XP de supervivencia (ms) */
const XP_SURVIVAL_MS = 5 * 60 * 1000; // 5 minutos

// ─── Input Queue Item ─────────────────────────────────────────────────────────

interface QueuedInput {
  userId: string;
  input: ShooterInput;
}

interface RoomInstance {
  roomId: string;
  players: Map<string, ShooterPlayerState & { socketId: string }>;
  /** Active pooled projectiles — keyed by id */
  projectiles: Map<string, PooledProjectile>;
  tick: number;
  /** Timestamps of recent shots per userId for rate limiting */
  shotTimestamps: Map<string, number[]>;
  /** Disconnected players pending reconnection: userId → { expiresAt, state } */
  reconnecting: Map<string, { expiresAt: number; state: ShooterPlayerState & { socketId: string } }>;
  gameLoopInterval: ReturnType<typeof setInterval> | null;
  /** Timestamp de entrada al juego por userId (para calcular supervivencia) */
  joinTimestamps: Map<string, number>;
  /** Badges ya otorgados en esta sesión para evitar duplicados */
  badgesAwarded: Map<string, Set<string>>;
}

@Injectable()
export class ShooterEngineService implements OnModuleDestroy {
  private readonly logger = new Logger(ShooterEngineService.name);

  private server: Server | null = null;

  private room: RoomInstance = this.createEmptyRoom();

  /** Callback para limpiar el estado de zona cuando un jugador es eliminado */
  private onPlayerEliminated: ((userId: string) => void) | null = null;

  // ─── Input Queue (event handlers only push, never process logic) ──────────
  private readonly inputQueue: QueuedInput[] = [];

  // ─── Spatial Hash Grid for broad-phase collision ──────────────────────────
  private readonly playerGrid = new SpatialHashGrid<ShooterPlayerState & { socketId: string; id: string }>(80);
  /** Reusable query buffers to avoid allocations */
  private readonly queryBuf: Array<ShooterPlayerState & { socketId: string; id: string }> = [];
  private readonly querySeen = new Set<string>();

  // ─── Pre-allocated snapshot buffers ───────────────────────────────────────
  private snapshotPlayersBuf: ShooterPlayerState[] = [];
  private snapshotProjsBuf: Projectile[] = [];

  // ─── Pre-allocated removal list ───────────────────────────────────────────
  private readonly toRemoveIds: string[] = [];

  constructor(
    private readonly collision: CollisionService,
  ) {}

  /** Registrar callback de eliminación (llamado desde el gateway/zone service) */
  setOnPlayerEliminatedCallback(cb: (userId: string) => void): void {
    this.onPlayerEliminated = cb;
  }

  onModuleDestroy() {
    this.stopGameLoop();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  setServer(server: Server) {
    this.server = server;
  }

  /**
   * Add a player to the persistent room.
   * If the player is reconnecting within 10 s, restore their previous state.
   */
  addPlayer(userId: string, name: string, socketId: string): void {
    // Check reconnection window
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
        { width: ARENA_WIDTH, height: ARENA_HEIGHT },
        COVER_STRUCTURES,
        occupiedPositions,
      );
      const player: ShooterPlayerState & { socketId: string } = {
        userId,
        name,
        lives: INITIAL_LIVES,
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

    // Registrar timestamp de entrada para cálculo de supervivencia
    this.room.joinTimestamps.set(userId, Date.now());
    if (!this.room.badgesAwarded.has(userId)) {
      this.room.badgesAwarded.set(userId, new Set());
    }

    // Start game loop if not already running
    if (!this.room.gameLoopInterval && this.room.players.size > 0) {
      this.startGameLoop();
    }
  }

  /**
   * Remove a player from the room.
   * Emits playerLeft and unlocks zone if < MAX_PLAYERS.
   */
  removePlayer(userId: string): void {
    const player = this.room.players.get(userId);
    if (!player) return;

    this.room.players.delete(userId);
    this.room.shotTimestamps.delete(userId);
    this.room.joinTimestamps.delete(userId);

    const activePlayers = this.room.players.size;

    const payload: PlayerLeftPayload = { userId, activePlayers };
    this.server?.to(ROOM_ID).emit('playerLeft', payload);

    // Emit returnToVirtualWorld to the leaving player with valid map coordinates
    const returnPayload: ReturnPayload = this.generateVirtualWorldSpawn();
    this.server?.to(player.socketId).emit('returnToVirtualWorld', returnPayload);

    this.logger.log(`Player ${userId} left room. Active: ${activePlayers}`);

    if (activePlayers === 0) {
      this.stopGameLoop();
    }
  }

  /**
   * Mark a player as disconnected (pending reconnection for 10 s).
   */
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

    if (this.room.players.size === 0) {
      this.stopGameLoop();
    }
  }

  /**
   * Queue a player input for processing in the next tick.
   * Event handlers ONLY push — no game logic here.
   */
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

  // ─── Game loop ───────────────────────────────────────────────────────────────

  private startGameLoop() {
    if (this.room.gameLoopInterval) return;
    this.room.gameLoopInterval = setInterval(() => this.tick(), TICK_MS);
    this.logger.log('🚀 Game loop STARTED');
  }

  private stopGameLoop() {
    if (this.room.gameLoopInterval) {
      clearInterval(this.room.gameLoopInterval);
      this.room.gameLoopInterval = null;
      this.logger.log('Game loop paused (no players)');
    }
  }

  /**
   * Main tick — processes queued inputs, updates physics, checks collisions
   * via spatial hash, emits snapshot. Target: <16ms total.
   */
  private tick() {
    this.room.tick++;

    // ── 1. Drain input queue (O(k) where k = inputs since last tick) ──────
    this.processInputQueue();

    // ── 2. Update player positions (in-place, zero alloc) ─────────────────
    this.updatePlayers();

    // ── 3. Update projectiles + collision detection via spatial hash ───────
    this.updateProjectiles();

    // ── 4. Check last player standing ─────────────────────────────────────
    this.checkLastStanding();

    // ── 5. Survival rewards (throttled: every 30 ticks) ───────────────────
    this.checkSurvivalRewards();

    // ── 6. Emit snapshot (zero-copy where possible) ───────────────────────
    this.emitSnapshot();
  }

  // ─── Input queue processing ─────────────────────────────────────────────────

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
        player.vx = dx * PLAYER_SPEED;
        player.vy = dy * PLAYER_SPEED;
      } else if (input.action === 'shoot') {
        this.createProjectile(userId, input.aimDx ?? input.dx ?? 0, input.aimDy ?? input.dy ?? 0);
      }
    }
    // Clear queue without creating new array
    this.inputQueue.length = 0;
  }

  // ─── Player update (zero-alloc) ─────────────────────────────────────────────

  private updatePlayers(): void {
    for (const player of this.room.players.values()) {
      // Anti-cheat: validate velocity magnitude
      const speed = player.vx * player.vx + player.vy * player.vy;
      if (speed > MAX_SPEED_VIOLATION * MAX_SPEED_VIOLATION) {
        player.vx = 0;
        player.vy = 0;
      }

      player.x += player.vx;
      player.y += player.vy;

      // Clamp to arena bounds (in-place, no object creation)
      this.collision.clampPositionInPlace(player, ARENA_WIDTH, ARENA_HEIGHT, 20);

      // Resolve player-structure collisions (in-place)
      for (let i = 0, sLen = COVER_STRUCTURES.length; i < sLen; i++) {
        this.collision.resolvePlayerStructureCollisionInPlace(player, COVER_STRUCTURES[i]);
      }
    }
  }

  // ─── Projectile update with spatial hash ────────────────────────────────────

  private updateProjectiles(): void {
    this.toRemoveIds.length = 0;

    // Build spatial hash of players for this frame
    this.playerGrid.clear();
    for (const player of this.room.players.values()) {
      // Add 'id' field needed by SpatialEntity
      (player as any).id = player.userId;
      this.playerGrid.insert(player as any, PLAYER_RADIUS);
    }

    for (const [projId, proj] of this.room.projectiles) {
      proj.x += proj.vx;
      proj.y += proj.vy;

      // Projectile-wall collision
      if (proj.x - PROJECTILE_RADIUS <= 0 || proj.x + PROJECTILE_RADIUS >= ARENA_WIDTH ||
          proj.y - PROJECTILE_RADIUS <= 0 || proj.y + PROJECTILE_RADIUS >= ARENA_HEIGHT) {
        this.toRemoveIds.push(projId);
        continue;
      }

      // Projectile-structure collision (structures are static, no spatial hash needed)
      let hitStructure = false;
      for (let i = 0, sLen = COVER_STRUCTURES.length; i < sLen; i++) {
        if (this.collision.checkProjectileStructureCollision(proj, COVER_STRUCTURES[i])) {
          hitStructure = true;
          break;
        }
      }
      if (hitStructure) {
        this.toRemoveIds.push(projId);
        continue;
      }

      // Projectile-player collision via spatial hash (O(1) average instead of O(n))
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
          this.applyHit(candidate as ShooterPlayerState & { socketId: string }, proj.ownerId);
          hitPlayer = true;
          break;
        }
      }
      if (hitPlayer) continue;
    }

    // Remove dead projectiles and return to pool
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

  // ─── Last standing check ────────────────────────────────────────────────────

  private checkLastStanding(): void {
    if (this.room.players.size <= 1) return;
    let aliveCount = 0;
    let lastAliveId = '';
    for (const p of this.room.players.values()) {
      if (p.lives > 0) {
        aliveCount++;
        lastAliveId = p.userId;
        if (aliveCount > 1) return; // early exit
      }
    }
    if (aliveCount === 1) {
      this.server?.to(ROOM_ID).emit('lastPlayerStanding', { userId: lastAliveId });
    }
  }

  // ─── Hit / respawn logic ─────────────────────────────────────────────────────

  private applyHit(victim: ShooterPlayerState & { socketId: string }, attackerId: string) {
    victim.lives = Math.max(0, victim.lives - 1);

    const hitPayload: PlayerHitPayload = {
      victimId: victim.userId,
      attackerId,
      livesRemaining: victim.lives,
    };
    this.server?.to(ROOM_ID).emit('playerHit', hitPayload);

    if (victim.lives === 0) {
      // Eliminated
      victim.deaths++;

      const attacker = this.room.players.get(attackerId);
      if (attacker) attacker.kills++;

      const elimPayload: PlayerEliminatedPayload = {
        eliminatedId: victim.userId,
        killerId: attackerId,
      };
      this.server?.to(ROOM_ID).emit('playerEliminated', elimPayload);

      // Emit XP events (internal — no external microservice calls)
      this.emitXpEvent(attackerId, 'kill', XP_PER_KILL);

      // Badge "Tirador del Campus" — 5 kills en la sesión
      if (attacker && attacker.kills >= BADGE_KILLS_THRESHOLD) {
        this.emitBadgeEvent(attackerId, 'tirador-del-campus');
      }

      // Return eliminated player to virtual world with valid map coordinates
      const returnPayload: ReturnPayload = this.generateVirtualWorldSpawn();
      this.server?.to(victim.socketId).emit('returnToVirtualWorld', returnPayload);

      // Remove from room and clear ALL re-entry state
      this.room.players.delete(victim.userId);
      this.room.shotTimestamps.delete(victim.userId);
      this.room.joinTimestamps.delete(victim.userId);
      this.room.reconnecting.delete(victim.userId);

      // Notificar al ZoneService para limpiar triggered y permitir re-entrada inmediata
      this.onPlayerEliminated?.(victim.userId);

      if (this.room.players.size === 0) this.stopGameLoop();
    } else {
      // Respawn in arena
      const spawn = this.collision.generateRespawnPosition({ width: ARENA_WIDTH, height: ARENA_HEIGHT });
      victim.x = spawn.x;
      victim.y = spawn.y;
      victim.vx = 0;
      victim.vy = 0;
    }
  }

  // ─── Projectile creation (uses object pool) ─────────────────────────────────

  private createProjectile(userId: string, dx: number, dy: number): void {
    // Rate limiting: max FIRE_RATE_LIMIT shots per second
    const now = Date.now();
    const timestamps = this.room.shotTimestamps.get(userId) ?? [];
    const recent = timestamps.filter(t => now - t < 1000);
    if (recent.length >= FIRE_RATE_LIMIT) return;

    recent.push(now);
    this.room.shotTimestamps.set(userId, recent);

    const player = this.room.players.get(userId);
    if (!player) return;

    // Normalize direction
    const len = Math.sqrt(dx * dx + dy * dy);
    const ndx = len > 0 ? dx / len : 1;
    const ndy = len > 0 ? dy / len : 0;

    // Acquire from pool instead of allocating
    const proj = projectilePool.acquire();
    proj.id = uuidv4();
    proj.ownerId = userId;
    proj.x = player.x;
    proj.y = player.y;
    proj.vx = ndx * PROJECTILE_SPEED;
    proj.vy = ndy * PROJECTILE_SPEED;
    proj.active = true;

    this.room.projectiles.set(proj.id, proj);
  }

  // ─── Snapshot emission (pre-allocated buffers) ──────────────────────────────

  private emitSnapshot() {
    if (!this.server) return;

    // Build players array — reuse buffer
    this.snapshotPlayersBuf.length = 0;
    for (const { socketId: _s, ...p } of this.room.players.values()) {
      this.snapshotPlayersBuf.push(p as ShooterPlayerState);
    }

    // Build projectiles array — reuse buffer
    this.snapshotProjsBuf.length = 0;
    for (const proj of this.room.projectiles.values()) {
      this.snapshotProjsBuf.push({ id: proj.id, ownerId: proj.ownerId, x: proj.x, y: proj.y, vx: proj.vx, vy: proj.vy });
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

  // ─── Factory ─────────────────────────────────────────────────────────────────

  private createEmptyRoom(): RoomInstance {
    return {
      roomId: ROOM_ID,
      players: new Map(),
      projectiles: new Map(),
      tick: 0,
      shotTimestamps: new Map(),
      reconnecting: new Map(),
      gameLoopInterval: null,
      joinTimestamps: new Map(),
      badgesAwarded: new Map(),
    };
  }

  // ─── XP / Badge helpers ──────────────────────────────────────────────────────

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

  /**
   * Verifica milestones de supervivencia en cada tick.
   * Solo se ejecuta cada ~1000 ms para no sobrecargar.
   */
  private checkSurvivalRewards(): void {
    if (this.room.tick % 30 !== 0) return;

    const now = Date.now();
    for (const [userId, joinTime] of this.room.joinTimestamps) {
      const elapsed = now - joinTime;
      const badges = this.room.badgesAwarded.get(userId) ?? new Set<string>();

      if (elapsed >= XP_SURVIVAL_MS && !badges.has('xp:survival-5min')) {
        badges.add('xp:survival-5min');
        this.room.badgesAwarded.set(userId, badges);
        this.emitXpEvent(userId, 'survival-5min', XP_SURVIVAL_5MIN);
      }

      if (elapsed >= BADGE_SURVIVAL_MS) {
        this.emitBadgeEvent(userId, 'sobreviviente');
      }
    }
  }

  /**
   * Genera coordenadas de spawn válidas para el mapa virtual.
   * Usa posiciones aleatorias en el mapa lejos de todas las zonas de juego:
   * - Football pads: x:620-880, y:540-660
   * - Shooter zone:  x:1200-1350, y:540-690
   */
  private generateVirtualWorldSpawn(): ReturnPayload {
    const WORLD_W = 1600;
    const WORLD_H = 1200;
    const MARGIN = 80;

    // Blocked zones with generous margin
    const blocked = [
      { x: 560, y: 480, w: 380, h: 240 },   // football pads area
      { x: 1140, y: 480, w: 270, h: 270 },  // shooter zone area
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

    // Safe fallback: top-left quadrant, well away from all zones
    return { spawnX: 300, spawnY: 300 };
  }
}
