import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  async check() {
    return {
      status: 'ok',
      storage: 'in-memory',
      timestamp: new Date().toISOString(),
    };
  }
}
