import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../../../../../../users/users.service';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
}

/**
 * Local user profile lookup. Previously this was an HTTP client that called
 * a separate `user-management` microservice; that service is no longer
 * deployed. We now read the profile from the local PostgreSQL `users` table
 * via `UsersService`.
 *
 * The external-method shape is preserved (`getUserById`, `getUserByEmail`)
 * so the call sites in the realtime use cases keep working unchanged.
 */
@Injectable()
export class UserManagementClient {
  private readonly logger = new Logger(UserManagementClient.name);

  constructor(private readonly users: UsersService) {}

  async getUserById(userId: string): Promise<UserProfile | null> {
    const user = await this.users.findById(userId);
    if (!user) {
      this.logger.warn(`User ${userId} not found in local store`);
      return null;
    }
    return this.toProfile(user);
  }

  async getUserByEmail(email: string): Promise<UserProfile | null> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      return null;
    }
    return this.toProfile(user);
  }

  private toProfile(user: { id: string; username: string; email: string }): UserProfile {
    return { id: user.id, name: user.username, email: user.email };
  }
}
