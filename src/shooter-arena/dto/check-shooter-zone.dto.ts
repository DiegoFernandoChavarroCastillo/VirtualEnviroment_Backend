import { IsNumber } from 'class-validator';

export class CheckShooterZoneDto {
  @IsNumber()
  x: number;

  @IsNumber()
  y: number;
}
