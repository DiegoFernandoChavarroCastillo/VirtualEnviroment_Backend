import { Module, Global } from '@nestjs/common';
import { VirtualWorldModule } from '../virtual-world/virtual-world.module';
import { ShooterGateway } from './infrastructure/adapters/in/shooter.gateway';
import { ShooterEngineService } from './application/services/shooter-engine.service';
import { ZoneService } from './application/services/zone.service';
import { CollisionService } from './application/services/collision.service';
import { GameConfigFileAdapter } from './infrastructure/adapters/out/game-config-file.adapter';
import { GAME_CONFIG_PORT } from './domain/ports/game-config.port';
import { ZONE_SERVICE_TOKEN } from '../virtual-world/infrastructure/adapters/in/virtual-map.gateway';

@Global()
@Module({
  imports: [
    VirtualWorldModule,
  ],
  providers: [
    ShooterGateway,
    ShooterEngineService,
    ZoneService,
    CollisionService,
    { provide: GAME_CONFIG_PORT, useClass: GameConfigFileAdapter },
    { provide: ZONE_SERVICE_TOKEN, useExisting: ZoneService },
  ],
  exports: [ZoneService, ZONE_SERVICE_TOKEN],
})
export class ShooterArenaModule {}
