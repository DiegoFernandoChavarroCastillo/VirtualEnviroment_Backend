import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeaderboardEntry } from '../domain/leaderboard-entry.entity';

export type LeaderboardPeriod = 'global' | 'weekly' | 'daily';

@Injectable()
export class LeaderboardService {
  constructor(
    @InjectRepository(LeaderboardEntry)
    private readonly entries: Repository<LeaderboardEntry>,
  ) {}

  async getTop(period: LeaderboardPeriod, limit: number): Promise<LeaderboardEntry[]> {
    const qb = this.entries
      .createQueryBuilder('e')
      .orderBy('e.score', 'DESC')
      .addOrderBy('e.playedAt', 'DESC')
      .take(limit);

    if (period === 'weekly') {
      qb.where('e.playedAt >= NOW() - INTERVAL \'7 days\'');
    } else if (period === 'daily') {
      qb.where('e.playedAt >= NOW() - INTERVAL \'1 day\'');
    }

    return qb.getMany();
  }

  async getForUser(username: string, limit: number): Promise<LeaderboardEntry[]> {
    return this.entries.find({
      where: { username },
      order: { playedAt: 'DESC' },
      take: limit,
    });
  }

  async recordMatch(input: {
    userId: string;
    username: string;
    kills: number;
    deaths: number;
    shotsFired: number;
    shotsHit: number;
    survivalTimeSeconds: number;
    highestStreak: number;
    score: number;
  }): Promise<LeaderboardEntry> {
    const accuracy = input.shotsFired > 0 ? input.shotsHit / input.shotsFired : 0;
    const entry = this.entries.create({
      ...input,
      accuracy,
    });
    return this.entries.save(entry);
  }
}
