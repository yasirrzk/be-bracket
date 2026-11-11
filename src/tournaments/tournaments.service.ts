import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MatchStatus, TournamentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';

interface MatchStructure {
  id: string;
  tournamentId: string;
  round: number;
  matchOrder: number;
  status: MatchStatus;
  homeId: string | null;
  awayId: string | null;
  homeScore: number;
  awayScore: number;
  winnerId: string | null;
  nextMatchId: string | null;
}

@Injectable()
export class TournamentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTournament(organizerId: string, dto: CreateTournamentDto) {
    return this.prisma.tournament.create({
      data: {
        title: dto.title,
        description: dto.description,
        maxParticipants: dto.maxParticipants,
        organizerId,
        status: TournamentStatus.REGISTRATION_OPEN,
      },
      include: {
        organizer: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });
  }

  async findAll(status?: TournamentStatus) {
    return this.prisma.tournament.findMany({
      where: status ? { status } : undefined,
      include: {
        organizer: {
          select: {
            id: true,
            username: true,
          },
        },
        _count: {
          select: {
            participants: true,
            matches: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        organizer: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
          orderBy: { seed: 'asc' },
        },
        matches: {
          include: {
            home: { select: { id: true, username: true } },
            away: { select: { id: true, username: true } },
            winner: { select: { id: true, username: true } },
          },
          orderBy: [{ round: 'asc' }, { matchOrder: 'asc' }],
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException(`Tournament with ID "${id}" not found`);
    }

    return tournament;
  }

  async registerParticipant(tournamentId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUnique({
        where: { id: tournamentId },
        include: {
          participants: true,
        },
      });

      if (!tournament) {
        throw new NotFoundException(`Tournament with ID "${tournamentId}" not found`);
      }

      if (tournament.status !== TournamentStatus.REGISTRATION_OPEN) {
        throw new BadRequestException('Tournament registration is not open');
      }

      if (tournament.participants.length >= tournament.maxParticipants) {
        throw new ConflictException('Tournament participant capacity reached');
      }

      const alreadyRegistered = tournament.participants.some(
        (p) => p.userId === userId,
      );
      if (alreadyRegistered) {
        throw new ConflictException('User is already registered in this tournament');
      }

      const seed = tournament.participants.length + 1;

      return tx.tournamentParticipant.create({
        data: {
          tournamentId,
          userId,
          seed,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
        },
      });
    });
  }

  async generateBracket(tournamentId: string, organizerId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUnique({
        where: { id: tournamentId },
        include: {
          participants: {
            orderBy: [{ seed: 'asc' }, { registeredAt: 'asc' }],
          },
          matches: true,
        },
      });

      if (!tournament) {
        throw new NotFoundException(`Tournament with ID "${tournamentId}" not found`);
      }

      if (organizerId && tournament.organizerId !== organizerId) {
        throw new BadRequestException('Only the tournament organizer can generate brackets');
      }

      if (tournament.matches.length > 0) {
        throw new ConflictException('Tournament bracket has already been generated');
      }

      const N = tournament.participants.length;
      if (N < 2) {
        throw new BadRequestException(
          'Tournament requires at least 2 registered participants to generate a bracket',
        );
      }

      // M = smallest power of 2 >= N
      let M = 1;
      while (M < N) {
        M *= 2;
      }
      const totalRounds = Math.round(Math.log2(M));

      // Construct matches round by round in memory
      const matchesByRound: Map<number, MatchStructure[]> = new Map();

      // Allocate match placeholders for every round
      for (let r = 1; r <= totalRounds; r++) {
        const matchesCount = M / Math.pow(2, r);
        const roundMatches: MatchStructure[] = [];

        for (let order = 1; order <= matchesCount; order++) {
          roundMatches.push({
            id: randomUUID(),
            tournamentId,
            round: r,
            matchOrder: order,
            status: MatchStatus.PENDING,
            homeId: null,
            awayId: null,
            homeScore: 0,
            awayScore: 0,
            winnerId: null,
            nextMatchId: null,
          });
        }
        matchesByRound.set(r, roundMatches);
      }

      // Link nextMatchId deterministically from child round to parent round
      for (let r = 1; r < totalRounds; r++) {
        const currentRoundMatches = matchesByRound.get(r)!;
        const nextRoundMatches = matchesByRound.get(r + 1)!;

        for (const match of currentRoundMatches) {
          const parentOrder = Math.ceil(match.matchOrder / 2);
          const parentMatch = nextRoundMatches.find(
            (m) => m.matchOrder === parentOrder,
          );
          if (parentMatch) {
            match.nextMatchId = parentMatch.id;
          }
        }
      }

      // Populate Round 1 participants and allocate Bye slots
      const round1Matches = matchesByRound.get(1)!;
      for (let i = 0; i < round1Matches.length; i++) {
        const match = round1Matches[i];
        const homeParticipant = tournament.participants[2 * i];
        const awayParticipant = tournament.participants[2 * i + 1];

        match.homeId = homeParticipant ? homeParticipant.userId : null;
        match.awayId = awayParticipant ? awayParticipant.userId : null;

        // Bye scenario: opponent slot is empty
        if (match.homeId && !match.awayId) {
          match.status = MatchStatus.COMPLETED;
          match.winnerId = match.homeId;

          // Promote immediately to parent match in round 2 if exists
          if (match.nextMatchId) {
            const nextRoundMatches = matchesByRound.get(2)!;
            const parentOrder = Math.ceil(match.matchOrder / 2);
            const parent = nextRoundMatches.find(
              (m) => m.matchOrder === parentOrder,
            );
            if (parent) {
              if (match.matchOrder % 2 === 1) {
                parent.homeId = match.winnerId;
              } else {
                parent.awayId = match.winnerId;
              }
            }
          }
        } else if (match.homeId && match.awayId) {
          match.status = MatchStatus.READY;
        }
      }

      // Update status for subsequent rounds if both opponents already populated (e.g. from byes)
      for (let r = 2; r <= totalRounds; r++) {
        const roundMatches = matchesByRound.get(r)!;
        for (const match of roundMatches) {
          if (match.homeId && match.awayId) {
            match.status = MatchStatus.READY;
          }
        }
      }

      // Insert all matches in reverse topological order (Round R down to Round 1)
      // to satisfy nextMatchId foreign key constraints in PostgreSQL
      for (let r = totalRounds; r >= 1; r--) {
        const matchesToInsert = matchesByRound.get(r)!;
        await tx.match.createMany({
          data: matchesToInsert,
        });
      }

      // Update tournament status
      await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          status: TournamentStatus.IN_PROGRESS,
        },
      });

      return {
        message: 'Bracket successfully generated',
        tournamentId,
        totalParticipants: N,
        bracketSize: M,
        totalRounds,
      };
    });
  }
}
