import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthModule } from './health/health.module';
import { FootballDuelModule } from './football-duel/football-duel.module';
import { ShooterArenaModule } from './shooter-arena/shooter-arena.module';

@Module({
  imports: [
    RealtimeModule,
    HealthModule,
    FootballDuelModule,
    ShooterArenaModule, // ShooterArenaModule exports ZONE_SERVICE_TOKEN
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
