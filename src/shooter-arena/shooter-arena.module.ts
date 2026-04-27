import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeModule } from '../realtime/realtime.module';
import { ShooterGateway } from './shooter.gateway';
import { ShooterEngineService } from './shooter-engine.service';
import { ZoneService } from './zone.service';
import { CollisionService } from './collision.service';
import { ZONE_SERVICE_TOKEN } from '../contexts/realtime/infrastructure/adapters/in/virtual-map.gateway';

@Global() // Make ZoneService available globally to avoid circular dependencies
@Module({
  imports: [
    RealtimeModule, // provides RedisRepository and JwtAuthGuard
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET || 'dev-secret-key',
        signOptions: { expiresIn: '24h' },
      }),
    }),
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
