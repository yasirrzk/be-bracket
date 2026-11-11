import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class RegisterParticipantDto {
  @ApiPropertyOptional({
    example: 'd8c82ec6-8964-4e92-944a-38e5527fc37a',
    description: 'User ID of the participant. If omitted, uses current authenticated user.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'userId must be a valid UUID v4' })
  userId?: string;
}
