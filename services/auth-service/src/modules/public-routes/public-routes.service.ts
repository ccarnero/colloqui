import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "@yoizen/database";
import { PUBLIC_ROUTES_CACHE_KEY_PREFIX } from "@yoizen/shared";
import type { PublicRouteEntry } from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import {
  PublicRoutesRepository,
  type IPublicRouteRow,
} from "./public-routes.repository";
import type { ICreatePublicRouteOptions } from "./public-routes.types";

@Injectable()
export class PublicRoutesService {
  private readonly logger = new PinoLoggerService(PublicRoutesService.name);

  constructor(
    private readonly publicRoutesRepository: PublicRoutesRepository,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async create(options: ICreatePublicRouteOptions): Promise<IPublicRouteRow> {
    const { method, pathPattern, scope, tenantId } = options;
    const id = crypto.randomUUID();

    const rows = await this.publicRoutesRepository.insertRoute(
      id,
      method,
      pathPattern,
      scope,
    );

    this.logger.log(
      `Created public route: ${method} ${pathPattern} (${scope}, ${this.publicRoutesRepository.environmentName})`,
    );

    await this.syncToRedis(tenantId);
    return rows[0] as IPublicRouteRow;
  }

  async list(tenantId?: string): Promise<IPublicRouteRow[]> {
    if (tenantId) {
      const tenantScope = `tenant:${tenantId}`;
      return this.publicRoutesRepository.listForTenant(tenantScope);
    }
    return this.publicRoutesRepository.listAll();
  }

  async remove(id: string, tenantId?: string): Promise<void> {
    const result = await this.publicRoutesRepository.deleteById(id);

    if (result.length === 0) {
      throw new NotFoundException(`Public route '${id}' not found`);
    }

    this.logger.log(`Removed public route ${id}`);
    await this.syncToRedis(tenantId);
  }

  private async syncToRedis(tenantId?: string): Promise<void> {
    const rows = await this.publicRoutesRepository.loadSyncRows();

    const entries: PublicRouteEntry[] = rows.map(
      (r: Record<string, unknown>) => ({
        method: r.method as string,
        path: r.path_pattern as string,
        scope: r.scope as PublicRouteEntry["scope"],
      }),
    );

    const env = this.publicRoutesRepository.environmentName;
    const baseKey = `${PUBLIC_ROUTES_CACHE_KEY_PREFIX}${env}`;
    await this.redis.set(baseKey, JSON.stringify(entries));

    if (tenantId) {
      const tenantScope = `tenant:${tenantId}`;
      const tenantEntries = entries.filter(
        (e) => e.scope === "platform" || e.scope === tenantScope,
      );
      const tenantKey = `${PUBLIC_ROUTES_CACHE_KEY_PREFIX}${env}:${tenantId}`;
      await this.redis.set(tenantKey, JSON.stringify(tenantEntries));
    }

    this.logger.log(
      `Synced ${entries.length} public routes to Redis (${baseKey})`,
    );
  }
}
