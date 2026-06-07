import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConnectionRequest, ConnectionStatus } from '../domain/connection-request.entity';
import { UsersService } from '../../users/application/users.service';

@Injectable()
export class ConnectionsService {
  constructor(
    @InjectRepository(ConnectionRequest)
    private readonly requests: Repository<ConnectionRequest>,
    private readonly users: UsersService,
  ) {}

  async create(requesterId: string, receiverId: string): Promise<ConnectionRequest> {
    if (requesterId === receiverId) {
      throw new NotFoundException('cannot connect with yourself');
    }
    const requester = await this.users.findById(requesterId);
    const receiver = await this.users.findById(receiverId);
    if (!requester || !receiver) {
      throw new NotFoundException('user not found');
    }

    const existing = await this.requests.findOne({
      where: { requesterId, receiverId },
      order: { createdAt: 'DESC' },
    });

    if (existing && existing.status !== 'REJECTED') {
      return existing;
    }

    const request = this.requests.create({
      requesterId,
      receiverId,
      status: 'PENDING' as ConnectionStatus,
    });
    return this.requests.save(request);
  }

  findForUser(userId: string): Promise<ConnectionRequest[]> {
    return this.requests.find({
      where: [{ receiverId: userId }, { requesterId: userId }],
      order: { createdAt: 'DESC' },
    });
  }
}
