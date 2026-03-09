import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../providers/redis.provider';
import {
  PUBLIC_ROUTES_CACHE_KEY_PREFIX,
  PUBLIC_ROUTES_CACHE_TTL,
} from '@yoizen/shared';
import type { PublicRouteEntry } from '@yoizen/shared';

@Injectable()
export class PublicRoutesCacheService {
  private readonly logger = new Logger(PublicRoutesCacheService.name);
  private readonly environment: string;

  private cachedRoutes: PublicRouteEntry[] = [];
  private cacheExpiresAt = 0;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.environment = process.env.PLATFORM_ENVIRONMENT ?? 'dev';
  }

  async getPublicRoutes(): Promise<PublicRouteEntry[]> {
    const now = Date.now();
    if (now < this.cacheExpiresAt) return this.cachedRoutes;

    try {
      const key = `${PUBLIC_ROUTES_CACHE_KEY_PREFIX}${this.environment}`;
      const raw = await this.redis.get(key);

      if (raw) {
        this.cachedRoutes = JSON.parse(raw) as PublicRouteEntry[];
      } else {
        this.cachedRoutes = [];
      }
    } catch (err) {
      this.logger.warn('Failed to fetch public routes from Redis, using stale cache');
    }

    this.cacheExpiresAt = now + PUBLIC_ROUTES_CACHE_TTL * 1_000;
    return this.cachedRoutes;
  }

  isMatch(
    routes: PublicRouteEntry[],
    method: string,
    path: string,
  ): boolean {
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      if (route.method !== '*' && route.method !== method) continue;
      if (this.pathMatches(route.path, path)) return true;
    }
    return false;
  }

  private pathMatches(pattern: string, actual: string): boolean {
    if (pattern === actual) return true;

    const patternParts = pattern.split('/');
    const actualParts = actual.split('/');

    if (patternParts.length !== actualParts.length) return false;

    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i];
      if (pp.startsWith(':')) continue;
      if (pp !== actualParts[i]) return false;
    }

    return true;
  }
}
