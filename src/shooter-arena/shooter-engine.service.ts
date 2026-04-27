import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { RedisRepository } from '../contexts/realtime/infrastructure/persistence/redis/redis.repository';
import { CollisionService } from './collision.service';
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
  ARENA_WIDTH,
  ARENA_HEIGHT,
  PLAYER_SPEED,
  PROJECTILE_SPEED,
  INITIAL_LIVES,
  MAX_PLAYERS,
  FIRE_RATE_LIMIT,
  TICK_MS,
  MAX_SPEED_VIOLATION,
  REDIS_PERSIST_INTERVAL,
  ROOM_ID,
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

interface RoomInstance {
  roomId: string;
  players: Map<string, ShooterPlayerState & { socketId: string }>;
  projectiles: Map<string, Projectile>;
  tick: number;
  lastPersistTime: number;
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

  /** Reference to the /shooter-arena namespace server */
  private server: Server | null = null;

  /** The single persistent room */
  private room: RoomInstance = this.createEmptyRoom();

  constructor(
    private readonly redis: RedisRepository,
    private readonly collision: CollisionService,
  ) {
    // Intentar restaurar sala desde Redis al arrancar
    this.restoreFromRedis().catch(() => {});
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
    if (reconnEntry && Date.now() < reconnEntry.expiresAt) {
      // Restore state with new socketId
      const restored = { ...reconnEntry.state, socketId };
      this.room.players.set(userId, restored);
      this.room.reconnecting.delete(userId);
      this.logger.log(`[Engine] Player ${userId} reconnected`);
    } else {
      // Fresh join
      const spawn = this.collision.generateRespawnPosition({ width: ARENA_WIDTH, height: ARENA_HEIGHT });
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

    // Pause game loop if no players remain
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

    this.room.reconnecting.set(userId, {
      expiresAt: Date.now() + 10_000,
      state: { ...player },
    });
    this.room.players.delete(userId);
    this.room.shotTimestamps.delete(userId);

    if (this.room.players.size === 0) {
      this.stopGameLoop();
    }
  }

  /**
   * Process a player input (move or shoot).
   */
  handlePlayerInput(userId: string, input: ShooterInput): void {
    const player = this.room.players.get(userId);
    if (!player) return;

    if (input.action === 'move') {
      const dx = input.dx ?? 0;
      const dy = input.dy ?? 0;
      player.vx = dx * PLAYER_SPEED;
      player.vy = dy * PLAYER_SPEED;
    } else if (input.action === 'shoot') {
      this.createProjectile(userId, input.aimDx ?? input.dx ?? 0, input.aimDy ?? input.dy ?? 0);
    }
  }

  getRoomState(): ShooterRoomState {
    return {
      roomId: ROOM_ID,
      players: Array.from(this.room.players.values()).map(({ socketId: _s, ...p }) => p),
      status: this.room.players.size > 0 ? 'active' : 'waiting',
      updatedAt: Date.now(),
    };
  }

  getActivePlayers(): number {
    return this.room.players.size;
  }

  // ─── Game loop ───────────────────────────────────────────────────────────────

  private startGameLoop() {
    if (this.room.gameLoopInterval) return; // already running
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

  private tick() {
    this.room.tick++;

    // 1. Update player positions
    for (const player of this.room.players.values()) {
      // Anti-cheat: validate velocity magnitude
      const speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
      if (speed > MAX_SPEED_VIOLATION) {
        player.vx = 0;
        player.vy = 0;
      }

      player.x += player.vx;
      player.y += player.vy;

      // Clamp to arena bounds
      const clamped = this.collision.clampPosition(
        { x: player.x, y: player.y },
        { width: ARENA_WIDTH, height: ARENA_HEIGHT },
        20, // PLAYER_RADIUS
      );
      player.x = clamped.x;
      player.y = clamped.y;
    }

    // 2. Update projectile positions
    const toRemove: string[] = [];
    for (const [projId, proj] of this.room.projectiles) {
      proj.x += proj.vx;
      proj.y += proj.vy;

      // 4. Detect projectile-wall collisions
      if (this.collision.checkProjectileWallCollision(proj, { width: ARENA_WIDTH, height: ARENA_HEIGHT })) {
        toRemove.push(projId);
        continue;
      }

      // 3. Detect projectile-player collisions
      for (const player of this.room.players.values()) {
        if (this.collision.checkProjectilePlayerCollision(proj, player)) {
          toRemove.push(projId);
          this.applyHit(player, proj.ownerId);
          break;
        }
      }
    }
    for (const id of toRemove) this.room.projectiles.delete(id);

    // 5. Check last player standing
    const alivePlayers = Array.from(this.room.players.values()).filter(p => p.lives > 0);
    if (alivePlayers.length === 1 && this.room.players.size > 1) {
      this.server?.to(ROOM_ID).emit('lastPlayerStanding', { userId: alivePlayers[0].userId });
    }

    // 5b. Check XP/badge milestones for survival
    this.checkSurvivalRewards();

    // 6. Emit snapshot
    this.emitSnapshot();

    // Persist to Redis periodically
    const now = Date.now();
    if (now - this.room.lastPersistTime >= REDIS_PERSIST_INTERVAL) {
      this.persistToRedis().catch(() => {});
      this.room.lastPersistTime = now;
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

      // Remove from room
      this.room.players.delete(victim.userId);
      this.room.shotTimestamps.delete(victim.userId);
      this.room.joinTimestamps.delete(victim.userId);

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

  // ─── Projectile creation ─────────────────────────────────────────────────────

  private createProjectile(userId: string, dx: number, dy: number): void {
    // Rate limiting: max FIRE_RATE_LIMIT shots per second
    const now = Date.now();
    const timestamps = this.room.shotTimestamps.get(userId) ?? [];
    const recent = timestamps.filter(t => now - t < 1000);
    if (recent.length >= FIRE_RATE_LIMIT) return; // rate limited

    recent.push(now);
    this.room.shotTimestamps.set(userId, recent);

    const player = this.room.players.get(userId);
    if (!player) return;

    // Normalize direction
    const len = Math.sqrt(dx * dx + dy * dy);
    const ndx = len > 0 ? dx / len : 1;
    const ndy = len > 0 ? dy / len : 0;

    const proj: Projectile = {
      id: uuidv4(),
      ownerId: userId,
      x: player.x,
      y: player.y,
      vx: ndx * PROJECTILE_SPEED,
      vy: ndy * PROJECTILE_SPEED,
    };

    this.room.projectiles.set(proj.id, proj);
  }

  // ─── Snapshot emission ───────────────────────────────────────────────────────

  private emitSnapshot() {
    if (!this.server) {
      return;
    }

    const snapshot: ShooterSnapshot = {
      roomId: ROOM_ID,
      tick: this.room.tick,
      timestamp: Date.now(),
      players: Array.from(this.room.players.values()).map(({ socketId: _s, ...p }) => p),
      projectiles: Array.from(this.room.projectiles.values()),
    };

    this.server.to(ROOM_ID).emit('snapshot', snapshot);
  }

  // ─── Redis persistence ───────────────────────────────────────────────────────

  private async persistToRedis(): Promise<void> {
    const state = this.getRoomState();
    await this.redis.setShooterRoomState(state);
  }

  /**
   * Al arrancar el servidor, si existe una sala activa en Redis con jugadores
   * registrados, restaura la sala en estado 'waiting' hasta que los jugadores
   * se reconecten.
   */
  private async restoreFromRedis(): Promise<void> {
    try {
      const saved = await this.redis.getShooterRoomState();
      if (!saved || saved.players.length === 0) return;

      this.logger.log(
        `Restoring shooter room from Redis with ${saved.players.length} registered players (status: waiting)`,
      );

      // Restaurar jugadores en estado waiting — sin socketId activo
      for (const p of saved.players) {
        const playerWithSocket = { ...p, socketId: '' };
        this.room.players.set(p.userId, playerWithSocket);
        this.room.joinTimestamps.set(p.userId, Date.now());
        this.room.badgesAwarded.set(p.userId, new Set());
      }

      // No iniciar el game loop — esperar a que los jugadores se reconecten
      this.logger.log('Room restored in waiting state. Game loop will start on first reconnection.');
    } catch (err) {
      this.logger.warn('Could not restore shooter room from Redis:', err);
    }
  }

  // ─── Factory ─────────────────────────────────────────────────────────────────

  private createEmptyRoom(): RoomInstance {
    return {
      roomId: ROOM_ID,
      players: new Map(),
      projectiles: new Map(),
      tick: 0,
      lastPersistTime: Date.now(),
      shotTimestamps: new Map(),
      reconnecting: new Map(),
      gameLoopInterval: null,
      joinTimestamps: new Map(),
      badgesAwarded: new Map(),
    };
  }

  // ─── XP / Badge helpers ──────────────────────────────────────────────────────

  /**
   * Emite un evento interno de XP. El XP_Service existente puede escuchar
   * estos eventos en el mismo proceso NestJS sin llamar a otros microservicios.
   */
  private emitXpEvent(userId: string, reason: string, amount: number): void {
    this.logger.log(`[XP] userId=${userId} reason=${reason} amount=${amount}`);
    // Emitir al namespace interno — el XP_Service puede suscribirse a este evento
    this.server?.serverSideEmit?.('xp:award', { userId, reason, amount });
  }

  /**
   * Emite un evento interno de badge, evitando duplicados en la misma sesión.
   */
  private emitBadgeEvent(userId: string, badge: string): void {
    const awarded = this.room.badgesAwarded.get(userId);
    if (!awarded || awarded.has(badge)) return; // ya otorgado
    awarded.add(badge);
    this.logger.log(`[Badge] userId=${userId} badge=${badge}`);
    this.server?.serverSideEmit?.('badge:award', { userId, badge });
  }

  /**
   * Verifica milestones de supervivencia en cada tick.
   * Solo se ejecuta cada ~1000 ms para no sobrecargar.
   */
  private checkSurvivalRewards(): void {
    // Solo verificar cada 30 ticks (~1 s a 30 ticks/s)
    if (this.room.tick % 30 !== 0) return;

    const now = Date.now();
    for (const [userId, joinTime] of this.room.joinTimestamps) {
      const elapsed = now - joinTime;
      const badges = this.room.badgesAwarded.get(userId) ?? new Set<string>();

      // XP de supervivencia a los 5 minutos
      if (elapsed >= XP_SURVIVAL_MS && !badges.has('xp:survival-5min')) {
        badges.add('xp:survival-5min');
        this.room.badgesAwarded.set(userId, badges);
        this.emitXpEvent(userId, 'survival-5min', XP_SURVIVAL_5MIN);
      }

      // Badge "Sobreviviente" a los 10 minutos
      if (elapsed >= BADGE_SURVIVAL_MS) {
        this.emitBadgeEvent(userId, 'sobreviviente');
      }
    }
  }

  /**
   * Genera coordenadas de spawn válidas para el mapa virtual.
   * Spawn cerca de la zona del shooter-arena (x: 1275, y: 615) pero fuera de ella.
   */
  private generateVirtualWorldSpawn(): ReturnPayload {
    // Zona del shooter-arena: x: 1275, y: 615, width: 150, height: 150
    // Spawn en un área cercana pero segura (arriba o a la izquierda de la zona)
    const MARGIN = 50;
    const options = [
      // Arriba de la zona
      { x: 1275 + Math.random() * 150, y: 615 - MARGIN - Math.random() * 100 },
      // Izquierda de la zona
      { x: 1275 - MARGIN - Math.random() * 100, y: 615 + Math.random() * 150 },
      // Arriba-izquierda
      { x: 1275 - MARGIN - Math.random() * 50, y: 615 - MARGIN - Math.random() * 50 },
    ];
    
    const spawn = options[Math.floor(Math.random() * options.length)];
    return {
      spawnX: Math.round(spawn.x),
      spawnY: Math.round(spawn.y),
    };
  }
}
