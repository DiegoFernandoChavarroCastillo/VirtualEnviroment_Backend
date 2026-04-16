import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();
    const token = this.extractToken(client);

    if (!token) {
      client.emit('error', { code: 'AUTH_ERROR', message: 'Authentication token missing' });
      throw new WsException('Authentication token missing');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'dev-secret-key',
      });
      // Preserve extra fields (like `name`) set by other handlers, but always update JWT claims
      client.data.user = { ...(client.data.user ?? {}), ...payload };
      return true;
    } catch (error) {
      client.emit('error', { code: 'AUTH_ERROR', message: `Invalid token: ${error.message}` });
      throw new WsException('Invalid authentication token');
    }
  }

  private extractToken(client: Socket): string | null {
    // Try auth.token first
    if (client.handshake.auth?.token) {
      return client.handshake.auth.token;
    }

    // Try headers.authorization
    const authHeader = client.handshake.headers?.authorization;
    if (authHeader) {
      return authHeader.replace('Bearer ', '');
    }

    return null;
  }
}
