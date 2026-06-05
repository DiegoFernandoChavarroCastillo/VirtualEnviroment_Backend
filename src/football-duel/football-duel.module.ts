import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { DuelPadService } from './duel-pad.service';
import { DuelEngineService } from './duel-engine.service';
import { CrownService } from './crown.service';
import { DuelPadGateway } from './duel-pad.gateway';
import { FootballDuelGateway } from './football-duel.gateway';

@Module({
  imports: [
    // RealtimeModule is @Global — provides JwtModule, JwtAuthGuard, WsAuthMiddleware
    // and InMemoryRepository as singletons.
    RealtimeModule,
  ],
  providers: [
    DuelPadService,
    DuelEngineService,
    CrownService,
    DuelPadGateway,
    FootballDuelGateway,
  ],
  exports: [DuelPadService, CrownService],
})
export class FootballDuelModule {}
