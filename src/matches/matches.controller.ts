import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubmitScoreDto } from './dto/submit-score.dto';
import { MatchesService } from './matches.service';

@ApiTags('Matches')
@Controller('matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get match details and bracket hierarchy links' })
  @ApiParam({ name: 'id', description: 'Match UUID identifier' })
  @ApiResponse({ status: 200, description: 'Match details retrieved' })
  @ApiResponse({ status: 404, description: 'Match not found' })
  async findById(@Param('id') id: string) {
    return this.matchesService.findById(id);
  }

  @Post(':id/score')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt')
  @Throttle({ short: { ttl: 1000, limit: 3 } })
  @ApiOperation({
    summary:
      'Submit final score and propagate winner to nextMatchId (Rate-limited: 3 req/sec)',
  })
  @ApiParam({ name: 'id', description: 'Match UUID identifier' })
  @ApiResponse({
    status: 200,
    description: 'Score registered, match completed, and winner promoted',
  })
  @ApiResponse({
    status: 400,
    description: 'Draw scores forbidden or match not READY/IN_PROGRESS',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Match not found' })
  async submitScore(
    @Param('id') id: string,
    @Body() dto: SubmitScoreDto,
  ) {
    return this.matchesService.submitScore(id, dto);
  }
}
