import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { HttpAuthenticatedUser } from '../guards/http-jwt-auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): HttpAuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user: HttpAuthenticatedUser }>();
    return req.user;
  },
);
