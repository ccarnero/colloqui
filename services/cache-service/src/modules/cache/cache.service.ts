import { Inject, Injectable } from "@nestjs/common";
import { REDIS_CLIENT } from "@yoizen/database";
import { evictOldestIfCapacityBeforeSet } from "@yoizen/shared";
import type Redis from "ioredis";
import { cacheServiceConfig } from "../../config";

interface IL1Entry {
  value: unknown;
  expiry: number;
}

@Injectable()
export class CacheService {
  private readonly l1: Map<string, IL1Entry> = new Map();
  private readonly maxL1Size: number;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.maxL1Size = cacheServiceConfig.cacheL1MaxSize;
  }

  /**
   * Reads a key from L1 (when fresh) then Redis; backfills L1 on Redis hit
   * with the key's REMAINING Redis TTL.
   *
   * GET and PTTL are issued in the same tick (`Promise.all`) so ioredis writes
   * both to the socket before either reply comes back — one round-trip, same
   * cost as the previous bare GET. They are NOT atomic (another client can
   * interleave), which is why a `-2` PTTL — the key vanished between the two
   * commands — skips the L1 backfill entirely instead of caching the value
   * forever.
   *
   * @param key - Fully scoped cache key.
   * @returns Parsed JSON value, raw string if not JSON, or `null` if missing.
   */
  async get(key: string): Promise<unknown | null> {
    const entry = this.l1.get(key);
    if (entry) {
      if (entry.expiry === 0 || Date.now() < entry.expiry) {
        return entry.value;
      }
      this.l1.delete(key);
    }
    const [raw, pttl] = await Promise.all([
      this.redis.get(key),
      this.redis.pttl(key),
    ]);
    if (raw === null) {
      return null;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return raw;
    }
    // PTTL: > 0 remaining ms, -1 key exists without TTL, -2 key is gone.
    if (pttl === -2) {
      return value;
    }
    this.setL1(key, value, pttl > 0 ? Date.now() + pttl : 0);
    return value;
  }

  /**
   * Writes through to Redis and updates L1.
   * @param key - Fully scoped cache key.
   * @param value - Value to JSON-serialize.
   * @param ttl - Optional Redis TTL in seconds.
   */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttl != null && ttl > 0) {
      await this.redis.set(key, serialized, "EX", ttl);
      this.setL1(key, value, Date.now() + ttl * 1000);
    } else {
      await this.redis.set(key, serialized);
      this.setL1(key, value, 0);
    }
  }

  /**
   * Deletes a key from Redis and L1.
   * @param key - Fully scoped cache key.
   */
  async del(key: string): Promise<void> {
    await this.redis.del(key);
    this.l1.delete(key);
  }

  /**
   * Lists keys matching a pattern via Redis SCAN.
   * @param pattern - Glob-style pattern.
   * @param count - Hints per SCAN iteration.
   * @returns Matching key names.
   */
  async scan(pattern: string, count: number): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, resultKeys] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        count
      );
      cursor = nextCursor;
      keys.push(...resultKeys);
    } while (cursor !== "0");
    return keys;
  }

  /**
   * Fetches many keys in one pipeline round-trip.
   * @param keys - Fully scoped cache keys.
   * @returns Map of key to value (JSON-parsed where applicable).
   */
  async batchGet(keys: string[]): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();
    if (keys.length === 0) {
      return result;
    }
    const pipeline = this.redis.pipeline();
    for (const key of keys) {
      pipeline.get(key);
    }
    const replies = await pipeline.exec();
    if (!replies) {
      return result;
    }
    replies.forEach(([err, raw], i) => {
      if (err || raw == null) {
        return;
      }
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
    evictOldestIfCapacityBeforeSet(this.l1, this.maxL1Size, key);
    this.l1.set(key, { value, expiry });
  }
}
