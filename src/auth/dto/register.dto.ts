import { IsHexColor, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'username may only contain letters, digits, _ . -' })
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @IsHexColor()
  avatarColor?: string;
}
