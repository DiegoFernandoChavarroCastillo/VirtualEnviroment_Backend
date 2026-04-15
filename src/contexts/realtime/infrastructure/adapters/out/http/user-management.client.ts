import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
}

@Injectable()
export class UserManagementClient {
  private readonly baseUrl: string;

  constructor(private readonly httpService: HttpService) {
    this.baseUrl = process.env.USER_MANAGEMENT_URL || 'http://localhost:3002';
  }

  async getUserById(userId: string): Promise<UserProfile | null> {
    try {
      const response = await this.httpService.axiosRef.get(
        `${this.baseUrl}/users/${userId}`,
      );
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        console.error(`User ${userId} not found (404)`);
      } else {
        console.error(`Failed to fetch user ${userId}:`, error.message);
      }
      return null;
    }
  }

  async getUserByEmail(email: string): Promise<UserProfile | null> {
    try {
      console.log(`[UserManagementClient] Fetching user by email: ${email}`);
      
      // Get all users and filter by email
      const response = await this.httpService.axiosRef.get(
        `${this.baseUrl}/users`,
      );
      const users = response.data;
      
      console.log(`[UserManagementClient] Found ${users.length} total users`);
      
      const user = users.find((u: any) => u.email === email);
      
      if (!user) {
        console.error(`[UserManagementClient] User with email ${email} not found in ${users.length} users`);
        console.log(`[UserManagementClient] Available emails:`, users.map((u: any) => u.email));
        return null;
      }
      
      console.log(`[UserManagementClient] Found user:`, user);
      return user;
    } catch (error) {
      console.error(`[UserManagementClient] Failed to fetch user by email ${email}:`, error.message);
      return null;
    }
  }
}
