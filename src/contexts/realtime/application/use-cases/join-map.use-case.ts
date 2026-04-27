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

  async execute(userId: string, userEmail: string, socketId: string, initialX?: number, initialY?: number): Promise<UserJoinedEvent> {
    // STEP 1: Clean up any stale data from previous sessions
    await this.redisRepository.deleteUserData(userId);
    
    // STEP 2: Fetch user profile by email from JWT
    const userProfile = await this.userManagementClient.getUserByEmail(userEmail);
    
    if (!userProfile) {
      throw new Error(`User with email ${userEmail} not found in user management service`);
    }

    const userName = userProfile.name || 'Unknown';

    // STEP 3: Create presence
    await this.redisRepository.setPresence(userId, socketId);

    // STEP 4: Save initial position — use client-provided coords if valid, else default
    const spawnX = (initialX != null && isFinite(initialX)) ? Math.round(initialX) : 400;
    const spawnY = (initialY != null && isFinite(initialY)) ? Math.round(initialY) : 300;
    await this.redisRepository.saveInitialPosition(userId, userName, spawnX, spawnY);

    return {
      userId,
      name: userName,
      email: userProfile.email || '',
      x: spawnX,
      y: spawnY,
      timestamp: new Date().toISOString(),
    };
  }
}
