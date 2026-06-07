import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { VirtualMapGateway } from './infrastructure/adapters/in/virtual-map.gateway';
import { RealtimeService } from './application/services/realtime.service';
import { JoinMapUseCase } from './application/use-cases/join-map.use-case';
import { UpdatePositionUseCase } from './application/use-cases/update-position.use-case';
import { SendChatUseCase } from './application/use-cases/send-chat.use-case';
import { InMemoryRepository } from './infrastructure/persistence/in-memory/in-memory.repository';
import { UserManagementClient } from './infrastructure/adapters/out/http/user-management.client';
import { WsAuthMiddleware } from '../../common/middleware/ws-auth.middleware';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UsersModule } from '../users/users.module';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

@Global()
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: JWT_SECRET,
        signOptions: { expiresIn: '24h' },
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 1000,
        limit: 20,
      },
    ]),
  ],
  providers: [
    VirtualMapGateway,
    RealtimeService,
    JoinMapUseCase,
    UpdatePositionUseCase,
    SendChatUseCase,
    InMemoryRepository,
    UserManagementClient,
    WsAuthMiddleware,
    JwtAuthGuard,
  ],
  exports: [
    InMemoryRepository,
    JwtAuthGuard,
    WsAuthMiddleware,
    JwtModule,
  ],
})
export class VirtualWorldModule {}
