import { Injectable } from '@nestjs/common';
import { InMemoryRepository } from '../../infrastructure/persistence/in-memory/in-memory.repository';
import { PositionUpdateEvent } from '../interfaces/events.interface';

@Injectable()
export class UpdatePositionUseCase {
  constructor(private readonly redisRepository: InMemoryRepository) {}

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
