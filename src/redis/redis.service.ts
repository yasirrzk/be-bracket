import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client?: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD', '');

    // In Vercel serverless, skip connecting to localhost if not configured
    if (process.env.VERCEL && (!host || host === 'localhost')) {
      this.logger.warn(
        'Redis host not configured in Vercel environment. Redis features disabled gracefully.',
      );
      return;
    }

    try {
      this.client = new Redis({
        host,
        port: Number(port),
        password: password || undefined,
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          if (times > 2) {
            return null; // Stop retrying
          }
          return Math.min(times * 100, 500);
        },
      });

      this.client.on('error', (err) => {
        this.logger.warn(`Redis connection error: ${err.message}`);
      });

      this.client
        .connect()
        .then(() => {
          this.logger.log('Redis connected successfully');
        })
        .catch((err) => {
          this.logger.warn(`Redis initial connect failed: ${err.message}`);
        });
    } catch (err: unknown) {
      this.logger.warn(`Failed to initialize Redis client: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        this.client.disconnect();
      } catch {
        // ignore
      }
      this.logger.log('Redis client disconnected');
    }
  }

  getClient(): Redis | undefined {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    try {
      if (!this.client || this.client.status !== 'ready') return null;
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (!this.client || this.client.status !== 'ready') return;
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err: unknown) {
      this.logger.warn(`Redis set failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      if (!this.client || this.client.status !== 'ready') return;
      await this.client.del(key);
    } catch (err: unknown) {
      this.logger.warn(`Redis del failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
    await this.set(`token:blacklist:${jti}`, '1', ttlSeconds);
  }

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const val = await this.get(`token:blacklist:${jti}`);
    return val !== null;
  }
}
