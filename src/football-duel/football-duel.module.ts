import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeModule } from '../realtime/realtime.module';
import { DuelPadService } from './duel-pad.service';
import { DuelEngineService } from './duel-engine.service';
import { CrownService } from './crown.service';
import { DuelPadGateway } from './duel-pad.gateway';
import { FootballDuelGateway } from './football-duel.gateway';

@Module({
  imports: [
    RealtimeModule, // provides InMemoryRepository and JwtAuthGuard
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET || 'dev-secret-key',
        signOptions: { expiresIn: '24h' },
      }),
    }),
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
