import { Injectable } from '@nestjs/common';
import { RedisRepository } from '../../infrastructure/persistence/redis/redis.repository';
import { AvatarPosition } from '../../domain/entities/avatar-position.entity';
import { PositionUpdateEvent } from '../interfaces/events.interface';

@Injectable()
export class UpdatePositionUseCase {
  constructor(private readonly redisRepository: RedisRepository) {}

  async execute(userId: string, name: string, x: number, y: number): Promise<PositionUpdateEvent> {
    const position = new AvatarPosition(userId, name, x, y);
    await this.redisRepository.setPosition(userId, position, 300);

    return {
      userId,
      x,
      y,
      timestamp: new Date().toISOString(),
    };
  }
}
