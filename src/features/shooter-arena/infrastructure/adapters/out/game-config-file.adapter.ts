import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  GameConfigPort,
  WeaponConfig,
  ShieldConfig,
  ArenaConfig,
} from '../../../domain/ports/game-config.port';

@Injectable()
export class GameConfigFileAdapter implements GameConfigPort {
  private weapons: Record<string, WeaponConfig>;
  private items: Record<string, ShieldConfig>;
  private arenaConfig: ArenaConfig;

  constructor() {
    const configDir = path.resolve(
      process.cwd(),
      'src/features/shooter-arena/domain/config',
    );
    this.weapons = JSON.parse(
      fs.readFileSync(path.join(configDir, 'weapons.json'), 'utf-8'),
    );
    this.items = JSON.parse(
      fs.readFileSync(path.join(configDir, 'items.json'), 'utf-8'),
    );
    this.arenaConfig = JSON.parse(
      fs.readFileSync(path.join(configDir, 'arena-config.json'), 'utf-8'),
    );
  }

  getWeapon(type: string): WeaponConfig | undefined {
    return this.weapons[type];
  }

  getAllWeapons(): Record<string, WeaponConfig> {
    return this.weapons;
  }

  getItem(type: string): ShieldConfig | undefined {
    return this.items[type];
  }

  getArenaConfig(): ArenaConfig {
    return this.arenaConfig;
  }
}
