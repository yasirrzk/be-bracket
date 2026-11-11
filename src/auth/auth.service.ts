import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async register(dto: RegisterDto) {
    const existingEmail = await this.usersService.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictException('Email is already registered');
    }

    const existingUsername = await this.usersService.findByUsername(dto.username);
    if (existingUsername) {
      throw new ConflictException('Username is already taken');
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.usersService.create({
      email: dto.email,
      username: dto.username,
      passwordHash,
      role: dto.role,
    });

    const tokens = await this.generateTokens({
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    });

    return {
      user,
      tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await argon2.verify(user.password, dto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.generateTokens({
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      tokens,
    };
  }

  async refreshToken(dto: RefreshTokenDto) {
    try {
      const refreshSecret = this.configService.get<string>(
        'JWT_REFRESH_SECRET',
        'super-secret-refresh-key-change-in-production',
      );

      const payload = await this.jwtService.verifyAsync<JwtPayload>(
        dto.refreshToken,
        {
          secret: refreshSecret,
        },
      );

      const isBlacklisted = await this.redisService.isTokenBlacklisted(payload.jti);
      if (isBlacklisted) {
        throw new UnauthorizedException('Token telah dicabut');
      }

      // Blacklist old refresh token before rotation
      const now = Math.floor(Date.now() / 1000);
      const remainingTtl = payload.exp ? Math.max(1, payload.exp - now) : 604800;
      await this.redisService.blacklistToken(payload.jti, remainingTtl);

      // Issue new pair
      return this.generateTokens({
        sub: payload.sub,
        email: payload.email,
        username: payload.username,
        role: payload.role,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(userPayload: { jti: string; exp?: number }, refreshToken?: string) {
    const now = Math.floor(Date.now() / 1000);

    // Blacklist access token
    if (userPayload?.jti) {
      const accessTtl = userPayload.exp
        ? Math.max(1, userPayload.exp - now)
        : 900; // 15 mins
      await this.redisService.blacklistToken(userPayload.jti, accessTtl);
    }

    // Blacklist refresh token if provided
    if (refreshToken) {
      try {
        const refreshSecret = this.configService.get<string>(
          'JWT_REFRESH_SECRET',
          'super-secret-refresh-key-change-in-production',
        );
        const refPayload = await this.jwtService.verifyAsync<JwtPayload>(
          refreshToken,
          {
            secret: refreshSecret,
          },
        );
        if (refPayload?.jti) {
          const refTtl = refPayload.exp
            ? Math.max(1, refPayload.exp - now)
            : 604800; // 7 days
          await this.redisService.blacklistToken(refPayload.jti, refTtl);
        }
      } catch {
        // Refresh token might already be expired, ignore
      }
    }

    return { message: 'Logged out successfully' };
  }

  private async generateTokens(payload: {
    sub: string;
    email: string;
    username: string;
    role: string;
  }) {
    const accessJti = randomUUID();
    const refreshJti = randomUUID();

    const accessSecret = this.configService.get<string>(
      'JWT_ACCESS_SECRET',
      'super-secret-access-key-change-in-production',
    );
    const refreshSecret = this.configService.get<string>(
      'JWT_REFRESH_SECRET',
      'super-secret-refresh-key-change-in-production',
    );

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...payload, jti: accessJti },
        { secret: accessSecret, expiresIn: '15m' },
      ),
      this.jwtService.signAsync(
        { ...payload, jti: refreshJti },
        { secret: refreshSecret, expiresIn: '7d' },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900,
    };
  }
}
