import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { POSTGRES_SQL, type Sql } from '../../providers/postgres.provider';
import { REDIS_CLIENT } from '../../providers/redis.provider';
import { PUBLIC_ROUTES_CACHE_KEY_PREFIX } from '@yoizen/shared';
import type { PublicRouteEntry } from '@yoizen/shared';

export interface PublicRouteRow {
  id: string;
  method: string;
  path_pattern: string;
  scope: string;
  environment: string;
  created_at: Date;
}

@Injectable()
export class PublicRoutesService {
  private readonly logger = new Logger(PublicRoutesService.name);
  private readonly environment: string;

  constructor(
    @Inject(POSTGRES_SQL) private readonly sql: Sql,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.environment = process.env.PLATFORM_ENVIRONMENT ?? 'dev';
  }

  async create(
    method: string,
    pathPattern: string,
    scope: string,
    tenantId?: string,
  ): Promise<PublicRouteRow> {
    const id = crypto.randomUUID();

    const rows = await this.sql`
      INSERT INTO public_routes (id, method, path_pattern, scope, environment)
      VALUES (${id}, ${method}, ${pathPattern}, ${scope}, ${this.environment})
      RETURNING id, method, path_pattern, scope, environment, created_at
    `;

    this.logger.log(
      `Created public route: ${method} ${pathPattern} (${scope}, ${this.environment})`,
    );

    await this.syncToRedis(tenantId);
    return rows[0] as PublicRouteRow;
  }

  async list(tenantId?: string): Promise<PublicRouteRow[]> {
    if (tenantId) {
      const tenantScope = `tenant:${tenantId}`;
      const rows = await this.sql`
        SELECT id, method, path_pattern, scope, environment, created_at
        FROM public_routes
        WHERE environment = ${this.environment}
          AND (scope = 'platform' OR scope = ${tenantScope})
        ORDER BY created_at DESC
      `;
      return rows as unknown as PublicRouteRow[];
    }

    const rows = await this.sql`
      SELECT id, method, path_pattern, scope, environment, created_at
      FROM public_routes
      WHERE environment = ${this.environment}
      ORDER BY created_at DESC
    `;
    return rows as unknown as PublicRouteRow[];
  }

  async remove(id: string, tenantId?: string): Promise<void> {
    const result = await this.sql`
      DELETE FROM public_routes
      WHERE id = ${id} AND environment = ${this.environment}
      RETURNING id
    `;

    if (result.length === 0) {
      throw new NotFoundException(`Public route '${id}' not found`);
    }

    this.logger.log(`Removed public route ${id}`);
    await this.syncToRedis(tenantId);
  }

  async syncToRedis(tenantId?: string): Promise<void> {
    const rows = await this.sql`
      SELECT method, path_pattern, scope
      FROM public_routes
      WHERE environment = ${this.environment}
    `;

    const entries: PublicRouteEntry[] = rows.map((r: Record<string, unknown>) => ({
      method: r.method as string,
      path: r.path_pattern as string,
      scope: r.scope as PublicRouteEntry['scope'],
    }));

    const baseKey = `${PUBLIC_ROUTES_CACHE_KEY_PREFIX}${this.environment}`;
    await this.redis.set(baseKey, JSON.stringify(entries));

    if (tenantId) {
      const tenantScope = `tenant:${tenantId}`;
      const tenantEntries = entries.filter(
        (e) => e.scope === 'platform' || e.scope === tenantScope,
      );
      const tenantKey = `${PUBLIC_ROUTES_CACHE_KEY_PREFIX}${this.environment}:${tenantId}`;
      await this.redis.set(tenantKey, JSON.stringify(tenantEntries));
    }

    this.logger.log(
      `Synced ${entries.length} public routes to Redis (${baseKey})`,
    );
  }
}
