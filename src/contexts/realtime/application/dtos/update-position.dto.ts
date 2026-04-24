import { IsNumber } from 'class-validator';

export class UpdatePositionDto {
  @IsNumber()
  x: number;

  @IsNumber()
  y: number;
}
