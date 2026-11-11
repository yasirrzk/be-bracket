import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MatchStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentsService } from './tournaments.service';

describe('TournamentsService - Bracket Generator', () => {
  let service: TournamentsService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      tournament: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
      match: {
        createMany: jest.fn(),
      },
      tournamentParticipant: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TournamentsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<TournamentsService>(TournamentsService);
  });

  it('should throw BadRequestException if less than 2 participants', async () => {
    mockPrisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      participants: [{ userId: 'user-1' }],
      matches: [],
    });

    await expect(service.generateBracket('tour-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should throw ConflictException if bracket was already generated', async () => {
    mockPrisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      participants: [{ userId: 'user-1' }, { userId: 'user-2' }],
      matches: [{ id: 'match-1' }],
    });

    await expect(service.generateBracket('tour-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('should generate balanced single-elimination bracket for power of two (4 participants)', async () => {
    const participants = [
      { userId: 'u1', seed: 1 },
      { userId: 'u2', seed: 2 },
      { userId: 'u3', seed: 3 },
      { userId: 'u4', seed: 4 },
    ];

    mockPrisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-4',
      participants,
      matches: [],
    });

    let createdMatches: any[] = [];
    mockPrisma.match.createMany.mockImplementation(({ data }: any) => {
      createdMatches.push(...data);
      return { count: data.length };
    });

    const result = await service.generateBracket('tour-4');

    expect(result.bracketSize).toBe(4);
    expect(result.totalRounds).toBe(2);
    expect(createdMatches.length).toBe(3); // 2 in R1, 1 in R2 (Final)

    const round1 = createdMatches.filter((m) => m.round === 1);
    const round2 = createdMatches.filter((m) => m.round === 2);

    expect(round1.length).toBe(2);
    expect(round2.length).toBe(1);

    // Both round 1 matches should point to the final match
    const finalMatch = round2[0];
    expect(round1[0].nextMatchId).toBe(finalMatch.id);
    expect(round1[1].nextMatchId).toBe(finalMatch.id);
    expect(finalMatch.nextMatchId).toBeNull();

    // Round 1 matches should be READY because both home and away are present
    expect(round1[0].status).toBe(MatchStatus.READY);
    expect(round1[1].status).toBe(MatchStatus.READY);
  });

  it('should generate bracket with automatic Bye allocation for odd participant count (3 participants)', async () => {
    const participants = [
      { userId: 'u1', seed: 1 },
      { userId: 'u2', seed: 2 },
      { userId: 'u3', seed: 3 },
    ];

    mockPrisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-3',
      participants,
      matches: [],
    });

    let createdMatches: any[] = [];
    mockPrisma.match.createMany.mockImplementation(({ data }: any) => {
      createdMatches.push(...data);
      return { count: data.length };
    });

    const result = await service.generateBracket('tour-3');

    // M should be 4, totalRounds = 2
    expect(result.bracketSize).toBe(4);
    expect(result.totalRounds).toBe(2);

    const round1 = createdMatches.filter((m) => m.round === 1);
    const round2 = createdMatches.filter((m) => m.round === 2);

    // Match 1 has u1 vs u2 -> READY
    const match1 = round1.find((m) => m.matchOrder === 1);
    expect(match1.homeId).toBe('u1');
    expect(match1.awayId).toBe('u2');
    expect(match1.status).toBe(MatchStatus.READY);

    // Match 2 has u3 vs Bye -> COMPLETED with winner u3
    const match2 = round1.find((m) => m.matchOrder === 2);
    expect(match2.homeId).toBe('u3');
    expect(match2.awayId).toBeNull();
    expect(match2.status).toBe(MatchStatus.COMPLETED);
    expect(match2.winnerId).toBe('u3');

    // u3 should be immediately promoted to parent match's awayId (because matchOrder 2 is even)
    const finalMatch = round2[0];
    expect(finalMatch.awayId).toBe('u3');
  });

  it('should connect deterministic nextMatchId without cyclic or dangling links (8 participants)', async () => {
    const participants = Array.from({ length: 8 }, (_, i) => ({
      userId: `user-${i + 1}`,
      seed: i + 1,
    }));

    mockPrisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-8',
      participants,
      matches: [],
    });

    let createdMatches: any[] = [];
    mockPrisma.match.createMany.mockImplementation(({ data }: any) => {
      createdMatches.push(...data);
      return { count: data.length };
    });

    const result = await service.generateBracket('tour-8');
    expect(result.bracketSize).toBe(8);
    expect(result.totalRounds).toBe(3);
    expect(createdMatches.length).toBe(7); // 4 + 2 + 1

    const matchIdSet = new Set(createdMatches.map((m) => m.id));
    for (const match of createdMatches) {
      if (match.round < 3) {
        expect(match.nextMatchId).not.toBeNull();
        expect(matchIdSet.has(match.nextMatchId)).toBe(true);
        expect(match.nextMatchId).not.toBe(match.id); // No self reference
      } else {
        expect(match.nextMatchId).toBeNull(); // Grand final has no next match
      }
    }
  });
});
