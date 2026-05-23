import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios';
import { ThrottlerModule } from '@nestjs/throttler';
import { RealtimeGateway } from './realtime.gateway';
import { VirtualMapGateway } from '../contexts/realtime/infrastructure/adapters/in/virtual-map.gateway';
import { RealtimeService } from '../contexts/realtime/application/services/realtime.service';
import { JoinMapUseCase } from '../contexts/realtime/application/use-cases/join-map.use-case';
import { UpdatePositionUseCase } from '../contexts/realtime/application/use-cases/update-position.use-case';
import { SendChatUseCase } from '../contexts/realtime/application/use-cases/send-chat.use-case';
import { InMemoryRepository } from '../contexts/realtime/infrastructure/persistence/in-memory/in-memory.repository';
import { UserManagementClient } from '../contexts/realtime/infrastructure/adapters/out/http/user-management.client';
import { ConnectionManagementClient } from '../contexts/realtime/infrastructure/adapters/out/http/connection-management.client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Global() // Make this module global so InMemoryRepository is a singleton
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET || 'dev-secret-key',
        signOptions: { expiresIn: '24h' },
      }),
    }),
    HttpModule,
    ThrottlerModule.forRoot([
      {
        ttl: 1000,
        limit: 20,
      },
    ]),
  ],
  providers: [
    RealtimeGateway,
    VirtualMapGateway,
    RealtimeService,
    JoinMapUseCase,
    UpdatePositionUseCase,
    SendChatUseCase,
    InMemoryRepository,
    UserManagementClient,
    ConnectionManagementClient,
    JwtAuthGuard,
  ],
  exports: [InMemoryRepository, JwtAuthGuard],
})
export class RealtimeModule {}
