import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SubmitScoreDto {
  @ApiProperty({ example: 3, description: 'Final score for home competitor (>= 0)' })
  @IsInt()
  @Min(0, { message: 'Score cannot be negative' })
  homeScore!: number;

  @ApiProperty({ example: 1, description: 'Final score for away competitor (>= 0)' })
  @IsInt()
  @Min(0, { message: 'Score cannot be negative' })
  awayScore!: number;
}
