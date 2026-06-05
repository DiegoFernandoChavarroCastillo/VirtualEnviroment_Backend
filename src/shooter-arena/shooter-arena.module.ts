import { Module, Global } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { ShooterGateway } from './shooter.gateway';
import { ShooterEngineService } from './shooter-engine.service';
import { ZoneService } from './zone.service';
import { CollisionService } from './collision.service';
import { ZONE_SERVICE_TOKEN } from '../contexts/realtime/infrastructure/adapters/in/virtual-map.gateway';

@Global() // Make ZoneService available globally to avoid circular dependencies
@Module({
  imports: [
    // RealtimeModule is @Global — provides JwtModule, JwtAuthGuard, WsAuthMiddleware
    // and InMemoryRepository as singletons.
    RealtimeModule,
  ],
  providers: [
    ShooterGateway,
    ShooterEngineService,
    ZoneService,
    CollisionService,
    // Expose ZoneService under the token so VirtualMapGateway can inject it
    { provide: ZONE_SERVICE_TOKEN, useExisting: ZoneService },
  ],
  exports: [ZoneService, ZONE_SERVICE_TOKEN],
})
export class ShooterArenaModule { }
