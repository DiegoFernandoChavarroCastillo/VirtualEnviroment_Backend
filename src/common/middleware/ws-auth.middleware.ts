import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

export interface AuthenticatedUser {
  sub: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * WsAuthMiddleware — single source of truth for socket authentication.
 *
 * The middleware runs in `handleConnection` of every gateway and:
 *   1. Extracts the JWT from `handshake.auth.token` (preferred) or the
 *      `Authorization: Bearer …` header.
 *   2. Verifies the signature with the shared `JWT_SECRET`.
 *   3. Stores the decoded payload in `client.data.user` for downstream
 *      handlers to read.
 *   4. Rejects (force-disconnects) the connection if the token is missing,
 *      malformed, expired, or signed with a different secret.
 *
 * Centralising the check here means individual `@SubscribeMessage`
 * handlers no longer need `@UseGuards(JwtAuthGuard)` — they can rely on
 * `client.data.user` being populated (or use `WsAuthGuard` defensively
 * to throw if it isn't).
 */
@Injectable()
export class WsAuthMiddleware {
  private readonly logger = new Logger(WsAuthMiddleware.name);

  constructor(private readonly jwtService: JwtService) {}

  /** Returns the authenticated user payload, or null if validation failed. */
  async authenticate(client: Socket): Promise<AuthenticatedUser | null> {
    const token = this.extractToken(client);
    if (!token) {
      this.reject(client, 'AUTH_ERROR', 'Authentication token missing');
      return null;
    }

    try {
      const payload = await this.jwtService.verifyAsync<AuthenticatedUser>(token);
      if (!payload?.sub) {
        this.reject(client, 'AUTH_ERROR', 'Token payload missing "sub" claim');
        return null;
      }
      client.data.user = payload;
      return payload;
    } catch (err) {
      this.reject(client, 'AUTH_ERROR', `Invalid token: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private extractToken(client: Socket): string | null {
    if (client.handshake.auth?.token) {
      return String(client.handshake.auth.token);
    }
    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    return null;
  }

  private reject(client: Socket, code: string, message: string): void {
    this.logger.warn(`Rejecting socket ${client.id}: ${message}`);
    try {
      client.emit('error', { code, message, timestamp: new Date().toISOString() });
    } catch {
      /* socket may already be torn down */
    }
    client.disconnect(true);
  }
}
