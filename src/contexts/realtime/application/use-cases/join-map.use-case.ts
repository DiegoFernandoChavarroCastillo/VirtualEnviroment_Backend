import { Injectable, Logger } from '@nestjs/common';
import { InMemoryRepository } from '../../infrastructure/persistence/in-memory/in-memory.repository';
import { UserManagementClient } from '../../infrastructure/adapters/out/http/user-management.client';
import { UserJoinedEvent } from '../interfaces/events.interface';

@Injectable()
export class JoinMapUseCase {
  private readonly logger = new Logger(JoinMapUseCase.name);

  constructor(
    private readonly repository: InMemoryRepository,
    private readonly userManagementClient: UserManagementClient,
  ) {}

  async execute(userId: string, userEmail: string, socketId: string, initialX?: number, initialY?: number): Promise<UserJoinedEvent> {
    // Clean up any stale data from previous sessions
    await this.repository.deleteUserData(userId);

    // Resolve profile — try by email first, fall back to userId
    let userProfile = await this.userManagementClient.getUserByEmail(userEmail);

    if (!userProfile) {
      this.logger.warn(`getUserByEmail failed for ${userEmail}, trying getUserById(${userId})`);
      userProfile = await this.userManagementClient.getUserById(userId);
    }

    if (!userProfile) {
      throw new Error(`User with email ${userEmail} not found in user management service`);
    }

    const userName = userProfile.name || 'Unknown';

    await this.repository.setPresence(userId, socketId);
    await this.repository.saveUserName(userId, userName);

    const spawnX = (initialX != null && isFinite(initialX)) ? Math.round(initialX) : 400;
    const spawnY = (initialY != null && isFinite(initialY)) ? Math.round(initialY) : 300;
    await this.repository.saveInitialPosition(userId, userName, spawnX, spawnY, userProfile.email || '');

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
