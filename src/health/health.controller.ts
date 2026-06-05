import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Check service health',
    description:
      'Returns the health status of the service. The service is STATEFUL and single-instance; storage is in process memory.',
  })
  @ApiOkResponse({
    description: 'Health status',
    schema: {
      example: { status: 'ok', storage: 'in-memory', timestamp: '2026-04-21T00:00:00.000Z' },
    },
  })
  async check() {
    return await this.healthService.check();
  }
}
