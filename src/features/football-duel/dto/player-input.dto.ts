import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class PlayerInputDto {
  @IsString()
  matchId: string;

  @IsEnum(['move', 'kick'])
  action: 'move' | 'kick';

  /** Horizontal direction: -1 (left), 0 (none), 1 (right) */
  @IsOptional()
  @IsNumber()
  @Min(-1)
  @Max(1)
  dx?: number;

  /** Vertical direction: -1 (up), 0 (none), 1 (down) */
  @IsOptional()
  @IsNumber()
  @Min(-1)
  @Max(1)
  dy?: number;
}
