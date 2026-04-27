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

// ─── Estructura de cobertura (obstáculo) ─────────────────────────────────────

export interface CoverStructure {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'square' | 'rectangle';
}

// ─── Snapshot (servidor → cliente, cada 33 ms) ────────────────────────────────

export interface ShooterSnapshot {
  roomId: string;
  tick: number;
  timestamp: number;
  players: ShooterPlayerState[];
  projectiles: Projectile[];
  structures?: CoverStructure[];
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
  structures: CoverStructure[];
  status: 'waiting' | 'active';
  updatedAt: number;
}

// ─── Constantes de juego ──────────────────────────────────────────────────────

export const ARENA_WIDTH = 1600;
export const ARENA_HEIGHT = 1200;
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

// ─── Estructuras de cobertura del mapa ───────────────────────────────────────

/**
 * 20 estructuras distribuidas estratégicamente en el mapa 1600×1200.
 * Zonas: bordes, centro (laberinto), cuadrantes intermedios.
 */
export const COVER_STRUCTURES: CoverStructure[] = [
  // ── Zona central — laberinto simple ──────────────────────────────────────
  { id: 'c1', x: 720,  y: 540,  width: 80,  height: 80,  type: 'square'    },
  { id: 'c2', x: 860,  y: 490,  width: 120, height: 40,  type: 'rectangle' },
  { id: 'c3', x: 760,  y: 660,  width: 40,  height: 100, type: 'rectangle' },
  { id: 'c4', x: 900,  y: 620,  width: 60,  height: 60,  type: 'square'    },

  // ── Cuadrante superior-izquierdo ─────────────────────────────────────────
  { id: 'q1a', x: 180,  y: 130,  width: 100, height: 40,  type: 'rectangle' },
  { id: 'q1b', x: 320,  y: 250,  width: 50,  height: 50,  type: 'square'    },
  { id: 'q1c', x: 100,  y: 320,  width: 40,  height: 120, type: 'rectangle' },

  // ── Cuadrante superior-derecho ───────────────────────────────────────────
  { id: 'q2a', x: 1280, y: 110,  width: 90,  height: 50,  type: 'rectangle' },
  { id: 'q2b', x: 1150, y: 270,  width: 50,  height: 50,  type: 'square'    },
  { id: 'q2c', x: 1420, y: 200,  width: 40,  height: 130, type: 'rectangle' },

  // ── Cuadrante inferior-izquierdo ─────────────────────────────────────────
  { id: 'q3a', x: 150,  y: 900,  width: 110, height: 40,  type: 'rectangle' },
  { id: 'q3b', x: 310,  y: 1010, width: 50,  height: 50,  type: 'square'    },
  { id: 'q3c', x: 90,   y: 780,  width: 40,  height: 100, type: 'rectangle' },

  // ── Cuadrante inferior-derecho ───────────────────────────────────────────
  { id: 'q4a', x: 1300, y: 950,  width: 100, height: 40,  type: 'rectangle' },
  { id: 'q4b', x: 1180, y: 1050, width: 60,  height: 60,  type: 'square'    },
  { id: 'q4c', x: 1450, y: 840,  width: 40,  height: 110, type: 'rectangle' },

  // ── Pasillos medios (separadores horizontales/verticales) ────────────────
  { id: 'm1', x: 500,  y: 580,  width: 150, height: 35,  type: 'rectangle' },
  { id: 'm2', x: 1050, y: 560,  width: 35,  height: 150, type: 'rectangle' },
  { id: 'm3', x: 600,  y: 900,  width: 80,  height: 40,  type: 'rectangle' },
  { id: 'm4', x: 1000, y: 280,  width: 40,  height: 80,  type: 'rectangle' },
];
