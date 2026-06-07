import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VirtualWorldModule } from './features/virtual-world/virtual-world.module';
import { HealthModule } from './features/health/health.module';
import { FootballDuelModule } from './features/football-duel/football-duel.module';
import { ShooterArenaModule } from './features/shooter-arena/shooter-arena.module';
import { UsersModule } from './features/users/users.module';
import { AuthModule } from './features/auth/auth.module';
import { LeaderboardModule } from './features/leaderboard/leaderboard.module';
import { ConnectionsModule } from './features/connections/connections.module';
import { buildDatabaseConfig } from './config/database.config';
import { FOOTBALL_DUEL_ENABLED } from './featureFlags';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => buildDatabaseConfig(),
    }),
    VirtualWorldModule,
    HealthModule,
    ...(FOOTBALL_DUEL_ENABLED ? [FootballDuelModule] : []),
    ShooterArenaModule,
    UsersModule,
    AuthModule,
    LeaderboardModule,
    ConnectionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
