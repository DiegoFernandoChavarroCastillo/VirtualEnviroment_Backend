import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../domain/user.entity';
import { PublicUser, toPublicUser } from '../dto/public-user';

export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
  avatarColor?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  findByUsername(username: string): Promise<User | null> {
    return this.users.findOne({ where: { username } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email } });
  }

  async create(input: CreateUserInput): Promise<User> {
    const user = this.users.create({
      username: input.username,
      email: input.email,
      passwordHash: input.passwordHash,
      avatarColor: input.avatarColor ?? '#e67e22',
    });
    return this.users.save(user);
  }

  async setRefreshTokenHash(id: string, hash: string | null): Promise<void> {
    await this.users.update({ id }, { refreshTokenHash: hash });
  }

  toPublic(user: User): PublicUser {
    return toPublicUser(user);
  }
}
