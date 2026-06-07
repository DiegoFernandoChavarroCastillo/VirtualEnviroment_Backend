import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ConnectionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

@Entity({ name: 'connection_requests' })
@Index(['requesterId', 'receiverId'])
export class ConnectionRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'requester_id' })
  requesterId!: string;

  @Index()
  @Column({ type: 'uuid', name: 'receiver_id' })
  receiverId!: string;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status!: ConnectionStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
