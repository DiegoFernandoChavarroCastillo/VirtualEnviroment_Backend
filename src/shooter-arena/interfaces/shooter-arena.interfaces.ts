// ─── Primitivos ───────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export interface PhysicsBody extends Vec2 {
  vx: number;
  vy: number;
}

// ─── Jugador en la arena ──────────────────────────────────────────────────────

export interface ShooterPlayerInfo {
  userId: string;
  name: string;
  lives: number;   // 0–3
  kills: number;
  deaths: number;
}

export interface ShooterPlayerState extends ShooterPlayerInfo, PhysicsBody {}

// ─── Proyectil ────────────────────────────────────────────────────────────────

export interface Projectile extends PhysicsBody {
  id: string;       // uuid
  ownerId: string;  // userId del disparador
}

// ─── Snapshot (servidor → cliente, cada 33 ms) ────────────────────────────────

export interface ShooterSnapshot {
  roomId: string;
  tick: number;
  timestamp: number;
  players: ShooterPlayerState[];
  projectiles: Projectile[];
}

// ─── Input (cliente → servidor) ──────────────────────────────────────────────

export type InputAction = 'move' | 'shoot';

export interface ShooterInput {
  action: InputAction;
  dx?: number;   // -1 | 0 | 1
  dy?: number;
  aimDx?: number; // Fase 3: apuntado con mouse
  aimDy?: number;
}

// ─── Payloads de eventos ──────────────────────────────────────────────────────

export interface PlayerHitPayload {
  victimId: string;
  attackerId: string;
  livesRemaining: number;
}

export interface PlayerEliminatedPayload {
  eliminatedId: string;
  killerId: string;
}

export interface PlayerLeftPayload {
  userId: string;
  activePlayers: number;
}

export interface RoomStatePayload {
  roomId: string;
  players: ShooterPlayerInfo[];
  activePlayers: number;
}

export interface ReturnPayload {
  spawnX: number;
  spawnY: number;
}

// ─── Estado de la sala (Redis) ────────────────────────────────────────────────

export interface ShooterRoomState {
  roomId: string;
  players: ShooterPlayerState[];
  status: 'waiting' | 'active';
  updatedAt: number;
}

// ─── Constantes de juego ──────────────────────────────────────────────────────

export const ARENA_WIDTH = 800;
export const ARENA_HEIGHT = 600;
export const PLAYER_RADIUS = 20;
export const PROJECTILE_RADIUS = 6;
export const PROJECTILE_SPEED = 8;        // px/tick
export const PLAYER_SPEED = 5;            // px/tick
export const MAX_PLAYERS = 6;
export const INITIAL_LIVES = 3;
export const FIRE_RATE_LIMIT = 3;         // disparos/segundo
export const TICK_RATE = 30;              // ticks/segundo
export const TICK_MS = 1000 / TICK_RATE;  // 33.33 ms
export const RECONCILE_THRESHOLD = 8;     // píxeles
export const CORRECTION_FRAMES = 3;
export const ZONE_ENTRY_MS = 2000;        // ms para entrar
export const ZONE_PRESENCE_TTL = 500;     // ms TTL Redis
export const MAX_SPEED_VIOLATION = 50;    // px de tolerancia anti-cheat
export const REDIS_PERSIST_INTERVAL = 5000; // ms

/** Posición de la Shooter_Zone en el canvas del VirtualWorld (1600×1200) */
export const SHOOTER_ZONE_RECT = { x: 1200, y: 540, width: 150, height: 150 };

/** Spawn radius al regresar al mundo virtual */
export const SPAWN_RADIUS = 80;

/** Centro de la zona shooter en el mapa virtual */
export const SHOOTER_ZONE_CENTER = { x: 1275, y: 615 };

/** ID de la sala persistente */
export const ROOM_ID = 'arena-main';
