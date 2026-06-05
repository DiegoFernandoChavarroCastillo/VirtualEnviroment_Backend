import { IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class AuthUserDto {
  @IsUUID()
  id!: string;

  @IsString()
  @Length(3, 30)
  username!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @Length(4, 7)
  avatarColor?: string;
}

export class AuthResponseDto {
  accessToken!: string;
  user!: AuthUserDto;
}
