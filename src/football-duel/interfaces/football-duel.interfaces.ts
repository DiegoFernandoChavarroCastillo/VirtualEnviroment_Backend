// ─── Domain Types ────────────────────────────────────────────────────────────

export type PadId = 'pad-a' | 'pad-b';
export type PadStatus = 'available' | 'occupied' | 'locked';
export type MatchStatus = 'waiting' | 'active' | 'finished';

// ─── Physics ─────────────────────────────────────────────────────────────────

export interface PhysicsBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// ─── Pad State ────────────────────────────────────────────────────────────────

export interface PadState {
  padId: PadId;
  status: PadStatus;
  occupantId?: string;
  occupantName?: string;
  occupiedAt?: number;
  /** 0.0 – 1.0: fraction of the 2-second activation window elapsed */
  activationProgress: number;
}

// ─── Player / Match ───────────────────────────────────────────────────────────

export interface PlayerInfo {
  userId: string;
  name: string;
  score: number;
}

export interface FootballDuelState {
  matchId: string;
  player1: PlayerInfo;
  player2: PlayerInfo;
  /** Seconds remaining in the match */
  timeRemaining: number;
  status: MatchStatus;
  ball: PhysicsBody;
}

// ─── Snapshot (sent every ~70 ms) ────────────────────────────────────────────

export interface DuelSnapshot {
  matchId: string;
  /** Physics tick counter */
  tick: number;
  timestamp: number;
  ball: PhysicsBody;
  players: Array<{ userId: string } & PhysicsBody>;
  /** userId → goals scored */
  score: Record<string, number>;
}

// ─── Crown ───────────────────────────────────────────────────────────────────

export interface CrownState {
  winnerId: string | null;
  winnerName?: string;
  /** Unix timestamp (ms) when the crown expires */
  expiresAt: number;
}

// ─── Player Input ─────────────────────────────────────────────────────────────

export interface PlayerInput {
  action: 'move' | 'kick';
  /** -1 | 0 | 1 */
  dx?: number;
  /** -1 | 0 | 1 */
  dy?: number;
}

// ─── WebSocket Payloads ───────────────────────────────────────────────────────

export interface DuelStartedPayload {
  matchId: string;
  player1: { userId: string; name: string };
  player2: { userId: string; name: string };
}

export interface MatchEndedPayload {
  matchId: string;
  winnerId: string | null;
  winnerName?: string;
  isDraw: boolean;
  finalScore: Record<string, number>;
}

export interface ReturnToVirtualWorldPayload {
  spawnX: number;
  spawnY: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Positions of the two duel pads on the 800×600 virtual-world canvas */
export const PAD_AREAS: Record<PadId, { x: number; y: number; width: number; height: number }> = {
  'pad-a': { x: 300, y: 460, width: 90, height: 90 },
  'pad-b': { x: 410, y: 460, width: 90, height: 90 },
};

/**
 * Goal areas on the 800×500 match canvas.
 * Player-1 (left side, x≈200) scores in the RIGHT goal.
 * Player-2 (right side, x≈600) scores in the LEFT goal.
 */
export const GOAL_AREAS = {
  left:  { x: 0,   y: 210, width: 20, height: 80 },
  right: { x: 780, y: 210, width: 20, height: 80 },
} as const;

export const AVATAR_RADIUS = 20;
export const BALL_RADIUS = 12;

/** Fixed physics timestep in ms (60 Hz) */
export const PHYSICS_STEP_MS = 16.67;

/** Emit a snapshot every N physics ticks (~70 ms at 60 Hz) */
export const SNAPSHOT_INTERVAL_TICKS = 4;

/** Default match duration in seconds (overridable via MATCH_DURATION_SECONDS env var) */
export const MATCH_DURATION_SECONDS = parseInt(process.env.MATCH_DURATION_SECONDS ?? '180', 10);

/** Maximum kick force in Matter.js units (anti-cheat ceiling) */
export const MAX_KICK_FORCE = 0.02;

/** Kick interaction radius in pixels */
export const KICK_RADIUS = 60;

/** Player movement speed in the match (px per physics tick) */
export const PLAYER_SPEED = 5;

/** Activation window for duel pads (ms) */
export const PAD_ACTIVATION_MS = 2000;

/** Presence TTL for pad occupancy in Redis (ms) */
export const PAD_PRESENCE_TTL_MS = 500;

/** Crown duration after a match win (seconds) */
export const CROWN_TTL_SECONDS = 120;

/** Spawn radius around the pad zone when returning to the virtual world */
export const SPAWN_RADIUS = 100;

/** Centre of the pad zone on the virtual-world canvas – used for spawn calculation */
export const PAD_ZONE_CENTER = { x: 400, y: 460 };
