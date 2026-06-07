import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SendChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  message: string;
}
