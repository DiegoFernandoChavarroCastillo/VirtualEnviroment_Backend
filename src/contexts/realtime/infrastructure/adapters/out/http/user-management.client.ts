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
      console.error(`Failed to fetch user ${userId}:`, error.message);
      return null;
    }
  }
}
