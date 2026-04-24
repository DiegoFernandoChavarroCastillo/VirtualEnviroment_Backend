import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';

@Injectable()
export class ConnectionManagementClient {
  private readonly baseUrl: string;

  constructor(private readonly httpService: HttpService) {
    this.baseUrl =
      process.env.CONNECTION_MANAGEMENT_URL || 'http://localhost:3003';
  }

  async createConnectionRequest(
    requesterId: string,
    receiverId: string,
  ): Promise<void> {
    try {
      await this.httpService.axiosRef.post(`${this.baseUrl}/connections`, {
        requesterId,
        receiverId,
      });
    } catch (error) {
      console.error('Failed to create connection request:', error.message);
      // Continue normal operation
    }
  }
}
