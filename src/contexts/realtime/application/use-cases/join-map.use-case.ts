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
    console.log(`[JoinMapUseCase] Looking up user by email: ${userEmail}`);
    
    // Fetch user profile by email from JWT
    const userProfile = await this.userManagementClient.getUserByEmail(userEmail);
    
    if (!userProfile) {
      const errorMsg = `User with email ${userEmail} not found in user management service`;
      console.error(`[JoinMapUseCase] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    console.log(`[JoinMapUseCase] Found user profile:`, userProfile);
    
    const userName = userProfile.name || 'Unknown';
    const userManagementId = userProfile.id;

    // Create presence using auth userId (from JWT)
    await this.redisRepository.setPresence(userId, socketId);

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
      email: userProfile.email || '',
      timestamp: new Date().toISOString(),
    };
  }
}
