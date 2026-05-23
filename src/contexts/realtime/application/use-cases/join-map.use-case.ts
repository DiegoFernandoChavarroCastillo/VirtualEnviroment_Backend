import { Injectable } from '@nestjs/common';
import { InMemoryRepository } from '../../infrastructure/persistence/in-memory/in-memory.repository';
import { UserManagementClient } from '../../infrastructure/adapters/out/http/user-management.client';
import { UserJoinedEvent } from '../interfaces/events.interface';

@Injectable()
export class JoinMapUseCase {
  constructor(
    private readonly redisRepository: InMemoryRepository,
    private readonly userManagementClient: UserManagementClient,
  ) {}

  async execute(userId: string, userEmail: string, socketId: string, initialX?: number, initialY?: number): Promise<UserJoinedEvent> {
    // STEP 1: Clean up any stale data from previous sessions
    await this.redisRepository.deleteUserData(userId);

    // STEP 2: Fetch user profile — try by email first, fall back to userId
    let userProfile = await this.userManagementClient.getUserByEmail(userEmail);

    if (!userProfile) {
      console.warn(`[JoinMapUseCase] getUserByEmail failed for ${userEmail}, trying getUserById(${userId})`);
      userProfile = await this.userManagementClient.getUserById(userId);
    }

    if (!userProfile) {
      throw new Error(`User with email ${userEmail} not found in user management service`);
    }

    const userName = userProfile.name || 'Unknown';

    // STEP 3: Create presence
    await this.redisRepository.setPresence(userId, socketId);

    // STEP 4: Persist the name with a long TTL so chat always has it
    await this.redisRepository.saveUserName(userId, userName);

    // STEP 5: Save initial position — use client-provided coords if valid, else default
    const spawnX = (initialX != null && isFinite(initialX)) ? Math.round(initialX) : 400;
    const spawnY = (initialY != null && isFinite(initialY)) ? Math.round(initialY) : 300;
    await this.redisRepository.saveInitialPosition(userId, userName, spawnX, spawnY, userProfile.email || '');

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
