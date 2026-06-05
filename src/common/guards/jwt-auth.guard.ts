import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { WsAuthMiddleware, AuthenticatedUser } from '../middleware/ws-auth.middleware';

/**
 * JwtAuthGuard — defensive guard for `@SubscribeMessage` handlers.
 *
 * Authentication itself happens in `WsAuthMiddleware` (during
 * `handleConnection`). This guard simply asserts that the middleware ran
 * and produced a user. Use it on handlers that need a runtime guarantee
 * (e.g. shared utilities that receive a generic `Socket`).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly wsAuth: WsAuthMiddleware) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();
    const user = client.data.user as AuthenticatedUser | undefined;
    if (!user?.sub) {
      // Late connections (middleware bypassed) — try once more.
      const recovered = await this.wsAuth.authenticate(client);
      if (!recovered) {
        throw new WsException('Unauthenticated socket');
      }
    }
    return true;
  }
}
