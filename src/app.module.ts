import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthModule } from './health/health.module';
import { FootballDuelModule } from './football-duel/football-duel.module';
import { ShooterArenaModule } from './shooter-arena/shooter-arena.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { ConnectionsModule } from './connections/connections.module';
import { buildDatabaseConfig } from './config/database.config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => buildDatabaseConfig(),
    }),
    RealtimeModule,
    HealthModule,
    FootballDuelModule,
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
