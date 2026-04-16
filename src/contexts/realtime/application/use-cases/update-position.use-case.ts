import { Injectable } from '@nestjs/common';
import { RedisRepository } from '../../infrastructure/persistence/redis/redis.repository';
import { PositionUpdateEvent } from '../interfaces/events.interface';

@Injectable()
export class UpdatePositionUseCase {
  constructor(private readonly redisRepository: RedisRepository) {}

  async execute(userId: string, x: number, y: number): Promise<PositionUpdateEvent | null> {
    // Update ONLY coordinates, name is preserved from initial position
    const result = await this.redisRepository.updatePositionCoordinates(userId, x, y);
    
    if (!result.success) {
      console.warn(`[UpdatePositionUseCase] ⚠️  Failed to update position for userId=${userId} (no existing position)`);
      return null;
    }

    return {
      userId,
      x,
      y,
      timestamp: new Date().toISOString(),
    };
  }
}
