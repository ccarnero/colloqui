import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import type {
  TenantConnectionManager,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import { agentAdminServiceConfig } from "../../config";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { REDIS_CLIENT } from "../../providers/redis.provider";
import { PinoLoggerService } from "@yoizen/observability";

const LAST_SYNC_KEY_PREFIX = "platform:admin:runtime:last_sync:";

/** Runtime health payload returned by {@link RuntimeService.getStatus}. */
export interface IRuntimeStatus {
  configured: boolean;
  connected_runtimes: string[];
  last_sync_at?: string;
}

@Injectable()
export class RuntimeService {
  private readonly logger = new PinoLoggerService(RuntimeService.name);

  constructor(
    private readonly tenantManager: YoizenclawTenantConnectionManager,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * @returns runtime status including DB connectivity and connected runtimes
   */
  async getStatus(tenantId: string): Promise<IRuntimeStatus> {
    this.logger.debug(`Getting runtime status for tenant: ${tenantId}`);

    let databaseConnected = false;
    try {
      if (agentAdminServiceConfig.dbEngine === "mongo") {
        const db = await (
          this.tenantManager as unknown as TenantMongoConnectionManager
        ).ensureSchema(tenantId);
        await db.command({ ping: 1 });
      } else {
        const sql = await (
          this.tenantManager as unknown as TenantConnectionManager
        ).ensureSchema(tenantId);
        await sql`SELECT 1`;
      }
      databaseConnected = true;
    } catch (error) {
      this.logger.warn(
        `Database connectivity check failed for tenant ${tenantId}`,
        error instanceof Error ? error.message : String(error),
      );
    }

    const syncKey = `${LAST_SYNC_KEY_PREFIX}${tenantId}`;
    let lastSyncAt: string | undefined;

    try {
      const existing = await this.redis.get(syncKey);
      if (databaseConnected && !existing) {
        const now = new Date().toISOString();
        await this.redis.set(syncKey, now);
        lastSyncAt = now;
      } else {
        lastSyncAt = existing ?? undefined;
      }
    } catch (error) {
      this.logger.warn(
        `Redis last_sync unavailable for tenant ${tenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (databaseConnected) {
        lastSyncAt = new Date().toISOString();
      }
    }

    const connectedRuntimes: string[] = databaseConnected
      ? [`runtime-${tenantId}-primary`]
      : [];

    return {
      configured: databaseConnected,
      connected_runtimes: connectedRuntimes,
      last_sync_at: lastSyncAt,
    };
  }
}
