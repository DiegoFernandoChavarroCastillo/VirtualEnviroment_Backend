import { Injectable, HttpStatus } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class HealthService {
  private redis: Redis;

  constructor() {
    // Support both REDIS_URL (cloud) and REDIS_HOST/PORT (local)
    const redisUrl = process.env.REDIS_URL;
    
    if (redisUrl) {
      // Use cloud Redis URL
      const useTls = process.env.REDIS_TLS === 'true';
      
      this.redis = new Redis(redisUrl, {
        ...(useTls && {
          tls: {
            rejectUnauthorized: false,
          },
        }),
        retryStrategy: (times) => {
          if (times > 3) return null; // Stop retrying after 3 attempts
          return Math.min(times * 50, 2000);
        },
        maxRetriesPerRequest: 3,
      });
    } else {
      // Fallback to local Redis
      this.redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      });
    }
  }

  async check() {
    try {
      // Check Redis connection
      await this.redis.ping();

      return {
        status: 'ok',
        redis: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        redis: 'disconnected',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
