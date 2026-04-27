import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthModule } from './health/health.module';
import { FootballDuelModule } from './football-duel/football-duel.module';
import { ShooterArenaModule } from './shooter-arena/shooter-arena.module';
import { ZoneService } from './shooter-arena/zone.service';
import { ZONE_SERVICE_TOKEN } from './contexts/realtime/infrastructure/adapters/in/virtual-map.gateway';

@Module({
  imports: [RealtimeModule, HealthModule, FootballDuelModule, ShooterArenaModule],
  controllers: [AppController],
  providers: [
    AppService,
    // Make ZoneService available to VirtualMapGateway (which lives in RealtimeModule)
    // by providing it at the root level under the injection token.
    { provide: ZONE_SERVICE_TOKEN, useExisting: ZoneService },
  ],
})
export class AppModule { }
