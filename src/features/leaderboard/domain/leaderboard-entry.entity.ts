import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { User } from '../../users/domain/user.entity';

@Entity({ name: 'leaderboard_entries' })
@Index(['user', 'playedAt'])
export class LeaderboardEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 30 })
  username!: string;

  @Column({ type: 'integer', default: 0 })
  kills!: number;

  @Column({ type: 'integer', default: 0 })
  deaths!: number;

  @Column({ type: 'integer', name: 'shots_fired', default: 0 })
  shotsFired!: number;

  @Column({ type: 'integer', name: 'shots_hit', default: 0 })
  shotsHit!: number;

  @Column({ type: 'real', default: 0 })
  accuracy!: number;

  @Column({ type: 'integer', name: 'survival_time_seconds', default: 0 })
  survivalTimeSeconds!: number;

  @Column({ type: 'integer', name: 'highest_streak', default: 0 })
  highestStreak!: number;

  @Column({ type: 'integer', default: 0 })
  score!: number;

  @CreateDateColumn({ name: 'played_at' })
  playedAt!: Date;
}
