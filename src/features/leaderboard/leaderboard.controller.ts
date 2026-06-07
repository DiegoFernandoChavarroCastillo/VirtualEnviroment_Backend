import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeaderboardService } from './application/leaderboard.service';

@ApiTags('leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly service: LeaderboardService) {}

  @Get('global')
  @ApiOperation({ summary: 'Top players of all time' })
  @ApiOkResponse({ description: 'Leaderboard entries' })
  global(@Query('limit') limit = '20') {
    return this.service.getTop('global', this.parseLimit(limit));
  }

  @Get('weekly')
  @ApiOperation({ summary: 'Top players of the last 7 days' })
  weekly(@Query('limit') limit = '20') {
    return this.service.getTop('weekly', this.parseLimit(limit));
  }

  @Get('daily')
  @ApiOperation({ summary: 'Top players of the last 24 hours' })
  daily(@Query('limit') limit = '20') {
    return this.service.getTop('daily', this.parseLimit(limit));
  }

  @Get('user/:username')
  @ApiOperation({ summary: 'Recent matches of a specific user' })
  userStats(@Param('username') username: string, @Query('limit') limit = '10') {
    return this.service.getForUser(username, this.parseLimit(limit));
  }

  private parseLimit(raw: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 20;
    return Math.min(n, 100);
  }
}
