export interface WeaponConfig {
  damage: number;
  speed: number;
  fireRate: number;
  ammo: number | null;
  pellets?: number;
  spread?: number;
  explosionRadius?: number;
}

export interface ShieldConfig {
  durationMs: number;
}

export interface ArenaConfig {
  arena: { width: number; height: number };
  player: { radius: number; speed: number; maxLives: number };
  projectile: { radius: number };
  gameplay: {
    maxPlayers: number;
    tickRate: number;
    fireRateLimit: number;
    reconcileThreshold: number;
    correctionFrames: number;
    zoneEntryMs: number;
    zonePresenceTtl: number;
    maxSpeedViolation: number;
  };
  xp: { perKill: number; survival5min: number; survivalMs: number };
  badges: { killsThreshold: number; survivalMs: number };
  shooterZone: {
    rect: { x: number; y: number; width: number; height: number };
    center: { x: number; y: number };
    spawnRadius: number;
  };
  room: { id: string };
}

export interface GameConfigPort {
  getWeapon(type: string): WeaponConfig | undefined;
  getAllWeapons(): Record<string, WeaponConfig>;
  getItem(type: string): ShieldConfig | undefined;
  getArenaConfig(): ArenaConfig;
}

export const GAME_CONFIG_PORT = 'GAME_CONFIG_PORT';
