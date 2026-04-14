import { Injectable } from '@nestjs/common';
import { RedisRepository } from '../../infrastructure/persistence/redis/redis.repository';
import { UserManagementClient } from '../../infrastructure/adapters/out/http/user-management.client';
import { UserJoinedEvent } from '../interfaces/events.interface';

@Injectable()
export class JoinMapUseCase {
  constructor(
    private readonly redisRepository: RedisRepository,
    private readonly userManagementClient: UserManagementClient,
  ) {}

  async execute(userId: string, socketId: string): Promise<UserJoinedEvent> {
    // Create presence
    await this.redisRepository.setPresence(userId, socketId);

    // Fetch user profile
    const userProfile = await this.userManagementClient.getUserById(userId);
    const userName = userProfile?.name || 'Unknown';

    // Set initial position (Center of map: 400, 300)
    const initialPosition = {
      userId,
      name: userName,
      x: 400,
      y: 300,
      timestamp: new Date(),
      toJSON: function() {
        return {
          userId: this.userId,
          name: this.name,
          x: this.x,
          y: this.y,
          timestamp: this.timestamp.toISOString(),
        };
      }
    };
    // Position TTL: 5 minutes (300 seconds)
    await this.redisRepository.setPosition(userId, initialPosition as any, 300);

    // Return event data
    return {
      userId,
      name: userName,
      email: userProfile?.email || '',
      timestamp: new Date().toISOString(),
    };
  }
}
