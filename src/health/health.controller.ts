import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check service health', description: 'Returns the health status of the service and its Redis connection.' })
  @ApiOkResponse({
    description: 'Health status',
    schema: {
      example: { status: 'ok', redis: 'connected', timestamp: '2026-04-21T00:00:00.000Z' },
    },
  })
  async check() {
    return await this.healthService.check();
  }
}
