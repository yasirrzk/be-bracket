import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { TournamentStatus } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { RegisterParticipantDto } from './dto/register-participant.dto';
import { TournamentsService } from './tournaments.service';

@ApiTags('Tournaments')
@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Create a new tournament' })
  @ApiResponse({ status: 201, description: 'Tournament successfully created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @CurrentUser('userId') organizerId: string,
    @Body() dto: CreateTournamentDto,
  ) {
    return this.tournamentsService.createTournament(organizerId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all tournaments with participant & match counts' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: TournamentStatus,
    description: 'Filter by tournament lifecycle status',
  })
  @ApiResponse({ status: 200, description: 'List of tournaments returned successfully' })
  async findAll(@Query('status') status?: TournamentStatus) {
    return this.tournamentsService.findAll(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tournament details, participants, and bracket matches' })
  @ApiParam({ name: 'id', description: 'Tournament UUID identifier' })
  @ApiResponse({ status: 200, description: 'Tournament details found' })
  @ApiResponse({ status: 404, description: 'Tournament not found' })
  async findById(@Param('id') id: string) {
    return this.tournamentsService.findById(id);
  }

  @Post(':id/register')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Register a participant to a tournament' })
  @ApiParam({ name: 'id', description: 'Tournament UUID' })
  @ApiResponse({ status: 201, description: 'Participant registered successfully' })
  @ApiResponse({ status: 400, description: 'Registration not open' })
  @ApiResponse({ status: 409, description: 'Capacity reached or user already registered' })
  async registerParticipant(
    @Param('id') id: string,
    @CurrentUser('userId') currentUserId: string,
    @Body() dto: RegisterParticipantDto,
  ) {
    const targetUserId = dto.userId || currentUserId;
    return this.tournamentsService.registerParticipant(id, targetUserId);
  }

  @Post(':id/generate-bracket')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Generate deterministic Single Elimination bracket with automatic Bye slots',
  })
  @ApiParam({ name: 'id', description: 'Tournament UUID' })
  @ApiResponse({
    status: 200,
    description: 'Bracket generated and tournament moved to IN_PROGRESS',
  })
  @ApiResponse({ status: 400, description: 'Less than 2 participants or unauthorized' })
  @ApiResponse({ status: 409, description: 'Bracket already generated' })
  async generateBracket(
    @Param('id') id: string,
    @CurrentUser('userId') organizerId: string,
  ) {
    return this.tournamentsService.generateBracket(id, organizerId);
  }
}
