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

  async execute(userId: string, userEmail: string, socketId: string): Promise<UserJoinedEvent> {
    console.log(`[JoinMapUseCase] 🚀 User joining: userId=${userId} email=${userEmail}`);
    
    // STEP 1: Clean up any stale data from previous sessions
    await this.redisRepository.deleteUserData(userId);
    console.log(`[JoinMapUseCase] 🧹 Cleaned up stale data for userId=${userId}`);
    
    // STEP 2: Fetch user profile by email from JWT - THIS IS THE SOURCE OF TRUTH FOR NAME
    const userProfile = await this.userManagementClient.getUserByEmail(userEmail);
    
    if (!userProfile) {
      const errorMsg = `User with email ${userEmail} not found in user management service`;
      console.error(`[JoinMapUseCase] ❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }

    const userName = userProfile.name || 'Unknown';
    
    // Validate we got a real name
    if (userName === 'Unknown') {
      console.error(`[JoinMapUseCase] 🚨 WARNING: User profile returned name="Unknown" for email=${userEmail}`);
    }

    console.log(`[JoinMapUseCase] ✅ Found user profile: name="${userName}" for userId=${userId}`);
    
    // STEP 3: Create presence (marks user as active)
    await this.redisRepository.setPresence(userId, socketId);

    // STEP 4: Save initial position with IMMUTABLE name from profile
    const initialX = 400;
    const initialY = 300;
    await this.redisRepository.saveInitialPosition(userId, userName, initialX, initialY);

    console.log(`[JoinMapUseCase] ✅ User ${userId} (${userName}) successfully joined the map`);

    // Return event data
    return {
      userId,
      name: userName,
      email: userProfile.email || '',
      timestamp: new Date().toISOString(),
    };
  }
}
