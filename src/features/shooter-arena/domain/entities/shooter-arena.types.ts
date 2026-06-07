export interface Vec2 {
  x: number;
  y: number;
}

export interface PhysicsBody extends Vec2 {
  vx: number;
  vy: number;
}

export interface ShooterPlayerInfo {
  userId: string;
  name: string;
  lives: number;
  kills: number;
  deaths: number;
}

export interface ShooterPlayerState extends ShooterPlayerInfo, PhysicsBody {
  shielded?: boolean;
  shieldExpiresAt?: number;
}

export type WeaponType = 'normal' | 'shotgun' | 'rocket' | 'laser';

export interface Projectile extends PhysicsBody {
  id: string;
  ownerId: string;
  weaponType?: WeaponType;
}

export interface CoverStructure {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'square' | 'rectangle';
}

export interface ShooterSnapshot {
  roomId: string;
  tick: number;
  timestamp: number;
  players: ShooterPlayerState[];
  projectiles: Projectile[];
  structures?: CoverStructure[];
}

export type InputAction = 'move' | 'shoot' | 'activateShield';

export interface ShooterInput {
  action: InputAction;
  dx?: number;
  dy?: number;
  aimDx?: number;
  aimDy?: number;
  weaponType?: WeaponType;
}

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

export interface RocketExplosionPayload {
  x: number;
  y: number;
  radius: number;
}

export interface ShieldAbsorbedPayload {
  victimId: string;
}

export interface ShooterRoomState {
  roomId: string;
  players: ShooterPlayerState[];
  structures: CoverStructure[];
  status: 'waiting' | 'active';
  updatedAt: number;
}

export const MAX_PLAYERS = 6;
export const ROOM_ID = 'arena-main';
export const PROJECTILE_RADIUS = 6;
export const PLAYER_RADIUS = 20;
export const TICK_MS = 1000 / 30;
