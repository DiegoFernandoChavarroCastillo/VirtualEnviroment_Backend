import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { UsersService } from '../users/application/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto, AuthUserDto } from './dto/auth-response.dto';
import { User } from '../users/domain/user.entity';

const REFRESH_COOKIE = 'rt';
const BCRYPT_ROUNDS = 12;
const ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? '24h';
const REFRESH_TTL = process.env.JWT_REFRESH_TTL ?? '7d';

interface RefreshPayload {
  sub: string;
  jti: string;
  username: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessSecret = process.env.JWT_SECRET ?? 'dev-secret-key';
  private readonly refreshSecret = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-key';

  constructor(
    private readonly users: UsersService,
    private readonly accessJwt: JwtService,
  ) {}

  get refreshJwt(): JwtService {
    return new JwtService({ secret: this.refreshSecret });
  }

  async register(dto: RegisterDto): Promise<{ response: AuthResponseDto; refreshCookie: string }> {
    const existingByUsername = await this.users.findByUsername(dto.username);
    if (existingByUsername) {
      throw new ConflictException('username already taken');
    }
    const existingByEmail = await this.users.findByEmail(dto.email);
    if (existingByEmail) {
      throw new ConflictException('email already registered');
    }

    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.users.create({
      username: dto.username,
      email: dto.email,
      passwordHash,
      avatarColor: dto.avatarColor,
    });

    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<{ response: AuthResponseDto; refreshCookie: string }> {
    const user = await this.users.findByUsername(dto.username);
    if (!user) {
      throw new UnauthorizedException('invalid credentials');
    }
    const ok = await compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('invalid credentials');
    }
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string | undefined): Promise<{ response: AuthResponseDto; refreshCookie: string }> {
    if (!refreshToken) {
      throw new UnauthorizedException('no refresh token');
    }
    let payload: RefreshPayload;
    try {
      payload = await this.refreshJwt.verifyAsync<RefreshPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('invalid refresh token');
    }
    if (!payload?.sub) {
      throw new UnauthorizedException('invalid refresh token');
    }

    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('user no longer exists');
    }

    const expectedHash = this.hashToken(refreshToken);
    if (user.refreshTokenHash !== expectedHash) {
      this.logger.warn(`Refresh token mismatch for user ${user.id} (token rotated or revoked)`);
      throw new UnauthorizedException('refresh token revoked');
    }

    return this.issueTokens(user);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    try {
      const payload = await this.refreshJwt.verifyAsync<RefreshPayload>(refreshToken);
      if (payload?.sub) {
        await this.users.setRefreshTokenHash(payload.sub, null);
      }
    } catch {
      // Token already invalid — nothing to do.
    }
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private async issueTokens(user: User): Promise<{ response: AuthResponseDto; refreshCookie: string }> {
    const accessToken = await this.accessJwt.signAsync(
      { sub: user.id, username: user.username, email: user.email },
      { expiresIn: ACCESS_TTL as `${number}${'s' | 'm' | 'h' | 'd'}` },
    );

    const jti = randomBytes(16).toString('hex');
    const refreshToken = await this.refreshJwt.signAsync(
      { sub: user.id, jti, username: user.username },
      { expiresIn: REFRESH_TTL as `${number}${'s' | 'm' | 'h' | 'd'}` },
    );
    const refreshHash = this.hashToken(refreshToken);
    await this.users.setRefreshTokenHash(user.id, refreshHash);

    const refreshCookie = this.buildRefreshCookie(refreshToken);

    return {
      response: {
        accessToken,
        user: this.toAuthUser(user),
      },
      refreshCookie,
    };
  }

  private buildRefreshCookie(token: string): string {
    const parts = [
      `${REFRESH_COOKIE}=${token}`,
      'HttpOnly',
      'Path=/auth',
      `Max-Age=${this.maxAgeFromTtl(REFRESH_TTL)}`,
      ...this.cookieSameSite(),
    ];
    return parts.join('; ');
  }

  buildClearedRefreshCookie(): string {
    const parts = [
      `${REFRESH_COOKIE}=`,
      'HttpOnly',
      'Path=/auth',
      'Max-Age=0',
      ...this.cookieSameSite(),
    ];
    return parts.join('; ');
  }

  private cookieSameSite(): string[] {
    return process.env.NODE_ENV === 'production'
      ? ['SameSite=None', 'Secure']
      : ['SameSite=Lax'];
  }

  private maxAgeFromTtl(ttl: string): number {
    const m = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (!m) return 7 * 24 * 60 * 60;
    const n = Number(m[1]);
    const unit = m[2];
    const mult = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
    return n * mult;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toAuthUser(user: User): AuthUserDto {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      avatarColor: user.avatarColor,
    };
  }
}
