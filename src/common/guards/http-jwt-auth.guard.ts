import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export interface HttpAuthenticatedUser {
  sub: string;
  username: string;
}

@Injectable()
export class HttpJwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: HttpAuthenticatedUser }>();
    const header = req.headers['authorization'];
    if (!header || Array.isArray(header) || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = header.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Empty bearer token');
    }

    try {
      const payload = await this.jwt.verifyAsync<HttpAuthenticatedUser>(token);
      if (!payload?.sub) {
        throw new UnauthorizedException('Invalid token payload');
      }
      req.user = { sub: payload.sub, username: payload.username };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
