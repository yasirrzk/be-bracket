import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MatchStatus, TournamentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MatchesService } from './matches.service';

describe('MatchesService - Score Propagation', () => {
  let service: MatchesService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      match: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      tournament: {
        update: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchesService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<MatchesService>(MatchesService);
  });

  it('should throw NotFoundException if match does not exist', async () => {
    mockPrisma.match.findUnique.mockResolvedValue(null);

    await expect(
      service.submitScore('non-existent-id', { homeScore: 2, awayScore: 1 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should reject score submission if match is in PENDING status', async () => {
    mockPrisma.match.findUnique.mockResolvedValue({
      id: 'match-pending',
      status: MatchStatus.PENDING,
      homeId: 'u1',
      awayId: 'u2',
    });

    await expect(
      service.submitScore('match-pending', { homeScore: 2, awayScore: 1 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject draw scores (tie forbidden in knockout bracket)', async () => {
    mockPrisma.match.findUnique.mockResolvedValue({
      id: 'match-draw',
      status: MatchStatus.READY,
      homeId: 'u1',
      awayId: 'u2',
    });

    await expect(
      service.submitScore('match-draw', { homeScore: 2, awayScore: 2 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should complete match and propagate winner to parent match (odd matchOrder -> homeId)', async () => {
    const currentMatch = {
      id: 'm1',
      tournamentId: 'tour-1',
      round: 1,
      matchOrder: 1, // Odd -> feeds homeId
      status: MatchStatus.READY,
      homeId: 'player-alpha',
      awayId: 'player-beta',
      nextMatchId: 'm-parent',
    };

    const parentMatch = {
      id: 'm-parent',
      tournamentId: 'tour-1',
      round: 2,
      matchOrder: 1,
      status: MatchStatus.PENDING,
      homeId: null,
      awayId: 'player-gamma', // Already filled
    };

    mockPrisma.match.findUnique
      .mockResolvedValueOnce(currentMatch) // First call: find current match
      .mockResolvedValueOnce(parentMatch); // Second call: find parent match

    mockPrisma.match.update.mockImplementation(({ where, data }: any) => ({
      id: where.id,
      ...data,
    }));

    const result = await service.submitScore('m1', { homeScore: 3, awayScore: 1 });

    expect(result.winnerId).toBe('player-alpha');

    // Current match must be COMPLETED
    expect(mockPrisma.match.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: {
        homeScore: 3,
        awayScore: 1,
        winnerId: 'player-alpha',
        status: MatchStatus.COMPLETED,
      },
    });

    // Parent match must have homeId set to winner and status updated to READY
    expect(mockPrisma.match.update).toHaveBeenCalledWith({
      where: { id: 'm-parent' },
      data: {
        homeId: 'player-alpha',
        awayId: 'player-gamma',
        status: MatchStatus.READY,
      },
    });
  });

  it('should complete tournament when final match score is submitted', async () => {
    const finalMatch = {
      id: 'm-final',
      tournamentId: 'tour-1',
      round: 3,
      matchOrder: 1,
      status: MatchStatus.READY,
      homeId: 'champ-a',
      awayId: 'champ-b',
      nextMatchId: null, // Final
    };

    mockPrisma.match.findUnique.mockResolvedValue(finalMatch);
    mockPrisma.match.update.mockResolvedValue({
      ...finalMatch,
      status: MatchStatus.COMPLETED,
      winnerId: 'champ-a',
    });

    await service.submitScore('m-final', { homeScore: 2, awayScore: 0 });

    expect(mockPrisma.tournament.update).toHaveBeenCalledWith({
      where: { id: 'tour-1' },
      data: { status: TournamentStatus.COMPLETED },
    });
  });
});
