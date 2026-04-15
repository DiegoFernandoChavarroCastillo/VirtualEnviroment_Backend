import { IsNumber } from 'class-validator';

export class CheckDuelPadsDto {
  @IsNumber()
  x: number;

  @IsNumber()
  y: number;
}
