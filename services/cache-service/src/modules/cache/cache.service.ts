import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../providers/redis.provider';

interface L1Entry {
  value: unknown;
  expiry: number;
}

@Injectable()
export class CacheService {
  private readonly l1: Map<string, L1Entry> = new Map();
  private readonly maxL1Size: number;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.maxL1Size = parseInt(process.env.CACHE_L1_MAX_SIZE ?? '1000', 10);
  }

  async get(key: string): Promise<unknown | null> {
    const entry = this.l1.get(key);
    if (entry) {
      if (entry.expiry === 0 || Date.now() < entry.expiry) {
        return entry.value;
      }
      this.l1.delete(key);
    }
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return raw;
    }
    this.setL1(key, value, 0);
    return value;
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttl != null && ttl > 0) {
      await this.redis.set(key, serialized, 'EX', ttl);
      this.setL1(key, value, Date.now() + ttl * 1000);
    } else {
      await this.redis.set(key, serialized);
      this.setL1(key, value, 0);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
    this.l1.delete(key);
  }

  async scan(pattern: string, count: number): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, resultKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        count,
      );
      cursor = nextCursor;
      keys.push(...resultKeys);
    } while (cursor !== '0');
    return keys;
  }

  async batchGet(keys: string[]): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();
    if (keys.length === 0) return result;
    const pipeline = this.redis.pipeline();
    for (const key of keys) {
      pipeline.get(key);
    }
    const replies = await pipeline.exec();
    if (!replies) return result;
    replies.forEach(([err, raw], i) => {
      if (err || raw == null) return;
      const key = keys[i];
      try {
        result.set(key, JSON.parse(raw as string));
      } catch {
        result.set(key, raw);
      }
    });
    return result;
  }

  private setL1(key: string, value: unknown, expiry: number): void {
    if (this.l1.size >= this.maxL1Size && !this.l1.has(key)) {
      const oldest = this.l1.keys().next().value;
      if (oldest !== undefined) this.l1.delete(oldest);
    }
    this.l1.set(key, { value, expiry });
  }
}
