import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MatchStatus, TournamentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitScoreDto } from './dto/submit-score.dto';

@Injectable()
export class MatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: {
        tournament: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
        home: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        away: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        winner: {
          select: {
            id: true,
            username: true,
          },
        },
        nextMatch: {
          select: {
            id: true,
            round: true,
            matchOrder: true,
            status: true,
          },
        },
        previousMatches: {
          select: {
            id: true,
            round: true,
            matchOrder: true,
            status: true,
            winnerId: true,
          },
        },
      },
    });

    if (!match) {
      throw new NotFoundException(`Match with ID "${id}" not found`);
    }

    return match;
  }

  async submitScore(matchId: string, dto: SubmitScoreDto) {
    return this.prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        include: {
          nextMatch: true,
        },
      });

      if (!match) {
        throw new NotFoundException(`Match with ID "${matchId}" not found`);
      }

      // Invariant: Status must be READY or IN_PROGRESS
      if (
        match.status !== MatchStatus.READY &&
        match.status !== MatchStatus.IN_PROGRESS
      ) {
        throw new BadRequestException(
          `Scores can only be submitted for matches in READY or IN_PROGRESS status (current status: ${match.status})`,
        );
      }

      // Invariant: Must have both competitors
      if (!match.homeId || !match.awayId) {
        throw new BadRequestException(
          'Both competitors must be present before score submission',
        );
      }

      // Invariant: Knockout matches cannot end in a draw
      if (dto.homeScore === dto.awayScore) {
        throw new BadRequestException(
          'Knockout tournament matches cannot end in a draw (scores must not be equal)',
        );
      }

      const winnerId = dto.homeScore > dto.awayScore ? match.homeId : match.awayId;

      // Update current match to COMPLETED
      const updatedMatch = await tx.match.update({
        where: { id: matchId },
        data: {
          homeScore: dto.homeScore,
          awayScore: dto.awayScore,
          winnerId,
          status: MatchStatus.COMPLETED,
        },
      });

      // Propagate winner to nextMatchId
      if (match.nextMatchId) {
        const parentMatch = await tx.match.findUnique({
          where: { id: match.nextMatchId },
        });

        if (parentMatch) {
          const isOddOrder = match.matchOrder % 2 === 1;
          const nextHomeId = isOddOrder ? winnerId : parentMatch.homeId;
          const nextAwayId = !isOddOrder ? winnerId : parentMatch.awayId;

          // If both slots are now filled, mark parent match as READY
          const willBeReady = Boolean(nextHomeId && nextAwayId);

          await tx.match.update({
            where: { id: match.nextMatchId },
            data: {
              homeId: nextHomeId,
              awayId: nextAwayId,
              status: willBeReady ? MatchStatus.READY : parentMatch.status,
            },
          });
        }
      } else {
        // Final match completed: conclude tournament
        await tx.tournament.update({
          where: { id: match.tournamentId },
          data: {
            status: TournamentStatus.COMPLETED,
          },
        });
      }

      return {
        message: 'Score submitted and winner successfully propagated',
        match: updatedMatch,
        winnerId,
      };
    });
  }
}
