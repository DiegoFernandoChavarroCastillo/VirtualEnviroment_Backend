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

    // Return event data
    return {
      userId,
      name: userProfile?.name || 'Unknown',
      email: userProfile?.email || '',
      timestamp: new Date().toISOString(),
    };
  }
}
