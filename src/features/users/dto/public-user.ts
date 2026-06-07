import { User } from '../domain/user.entity';

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  avatarColor: string;
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt,
  };
}
