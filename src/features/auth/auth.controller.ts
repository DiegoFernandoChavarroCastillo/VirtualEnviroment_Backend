import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { HttpJwtAuthGuard } from '../../common/guards/http-jwt-auth.guard';

const REFRESH_COOKIE = 'rt';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user account' })
  @ApiOkResponse({ description: 'User registered and authenticated' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const { response, refreshCookie } = await this.auth.register(dto);
    res.setHeader('Set-Cookie', refreshCookie);
    return response;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with username + password' })
  @ApiOkResponse({ description: 'Access token + Set-Cookie rt=<refresh>' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const { response, refreshCookie } = await this.auth.login(dto);
    res.setHeader('Set-Cookie', refreshCookie);
    return response;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOperation({
    summary: 'Rotate the access token using the HttpOnly refresh cookie',
    description: 'Reads the `rt` cookie, validates it, and returns a new access token + rotated refresh cookie.',
  })
  @ApiOkResponse({ description: 'New access token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const refreshCookie = this.readRefreshCookie(req);
    const { response, refreshCookie: newCookie } = await this.auth.refresh(refreshCookie);
    res.setHeader('Set-Cookie', newCookie);
    return response;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Invalidate the current refresh token' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const refreshCookie = this.readRefreshCookie(req);
    await this.auth.logout(refreshCookie);
    res.setHeader('Set-Cookie', this.auth.buildClearedRefreshCookie());
  }

  // Used by SocketContext to verify an access token before connecting.
  @Post('verify')
  @UseGuards(HttpJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a bearer access token' })
  async verify(): Promise<{ ok: true }> {
    return { ok: true };
  }

  private readRefreshCookie(req: Request): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    const cookies = header.split(';').map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith(`${REFRESH_COOKIE}=`)) {
        return decodeURIComponent(c.slice(REFRESH_COOKIE.length + 1));
      }
    }
    return undefined;
  }
}
