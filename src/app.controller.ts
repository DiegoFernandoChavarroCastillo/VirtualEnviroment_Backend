import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Root endpoint', description: 'Returns a hello message from the service.' })
  @ApiOkResponse({ description: 'Hello message', schema: { example: 'Hello World!' } })
  getHello(): string {
    return this.appService.getHello();
  }
}
