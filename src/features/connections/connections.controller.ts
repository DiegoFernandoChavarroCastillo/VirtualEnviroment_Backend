import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { HttpJwtAuthGuard } from '../../common/guards/http-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HttpAuthenticatedUser } from '../../common/guards/http-jwt-auth.guard';
import { ConnectionsService } from './application/connections.service';
import { ConnectionRequest } from './domain/connection-request.entity';

class CreateConnectionDto {
  @IsUUID()
  receiverId!: string;
}

@ApiTags('connections')
@ApiBearerAuth('JWT')
@UseGuards(HttpJwtAuthGuard)
@Controller('connections')
export class ConnectionsController {
  constructor(private readonly service: ConnectionsService) {}

  @Post()
  @ApiOperation({ summary: 'Send a connection request to another user' })
  @ApiOkResponse({ description: 'The connection request' })
  create(
    @CurrentUser() user: HttpAuthenticatedUser,
    @Body() dto: CreateConnectionDto,
  ): Promise<ConnectionRequest> {
    return this.service.create(user.sub, dto.receiverId);
  }

  @Get()
  @ApiOperation({ summary: 'List all connection requests for the current user' })
  list(@CurrentUser() user: HttpAuthenticatedUser): Promise<ConnectionRequest[]> {
    return this.service.findForUser(user.sub);
  }
}
