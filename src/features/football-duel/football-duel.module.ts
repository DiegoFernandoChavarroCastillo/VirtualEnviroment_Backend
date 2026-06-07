import { Module } from '@nestjs/common';
import { VirtualWorldModule } from '../virtual-world/virtual-world.module';
import { DuelPadService } from './duel-pad.service';
import { DuelEngineService } from './duel-engine.service';
import { CrownService } from './crown.service';
import { DuelPadGateway } from './duel-pad.gateway';
import { FootballDuelGateway } from './football-duel.gateway';

@Module({
  imports: [
    VirtualWorldModule,
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
