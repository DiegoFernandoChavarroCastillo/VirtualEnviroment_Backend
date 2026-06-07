import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UsersService } from './application/users.service';
import { PublicUser, toPublicUser } from './dto/public-user';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get the currently authenticated user profile' })
  @ApiOkResponse({
    description: 'Authenticated user profile',
    schema: {
      example: {
        id: '8e1f7c1a-7e6c-4d4f-9e4a-7e6c4d4f9e4a',
        username: 'diego',
        email: 'diego@example.com',
        avatarColor: '#e67e22',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    },
  })
  async me(@Req() req: Request): Promise<PublicUser> {
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const user = await this.usersService.findById(userId);
    return toPublicUser(user!);
  }
}
