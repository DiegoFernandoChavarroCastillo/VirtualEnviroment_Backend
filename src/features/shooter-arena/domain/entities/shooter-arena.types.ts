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
  health: number;
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
  healthRemaining: number;
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

export type PickupType = 'shotgun' | 'rocket' | 'shield' | 'health' | 'laser';

export interface PickupBox {
  x: number;
  y: number;
  type: PickupType;
  spawnTime: number;
}

export interface PickupCollectedPayload {
  x: number;
  y: number;
  type: PickupType;
}

export const PICKUP_SPAWN_POSITIONS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 400,  y: 200  },
  { x: 1200, y: 200  },
  { x: 400,  y: 1000 },
  { x: 1200, y: 1000 },
  { x: 800,  y: 350  },
  { x: 800,  y: 850  },
  { x: 250,  y: 600  },
  { x: 1350, y: 600  },
  { x: 600,  y: 200  },
  { x: 1000, y: 200  },
  { x: 400,  y: 400  },
  { x: 800,  y: 400  },
  { x: 1200, y: 400  },
  { x: 700,  y: 600  },
  { x: 900,  y: 600  },
  { x: 400,  y: 800  },
  { x: 600,  y: 800  },
  { x: 1000, y: 800  },
  { x: 1200, y: 800  },
];
