import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'player@example.com', description: 'Registered user email' })
  @IsEmail({}, { message: 'Invalid email address format' })
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'SuperSecurePass123!', description: 'User account password' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
