import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateTournamentDto {
  @ApiProperty({ example: 'Grand Championship 2026', description: 'Tournament title' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({
    example: 'Open single-elimination knockout tournament',
    description: 'Detailed description of rules or prizes',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 8,
    description: 'Maximum participants allowed (2 - 128)',
  })
  @IsInt()
  @Min(2, { message: 'Tournament must allow at least 2 participants' })
  @Max(128, { message: 'Maximum 128 participants supported per single bracket' })
  maxParticipants!: number;
}
