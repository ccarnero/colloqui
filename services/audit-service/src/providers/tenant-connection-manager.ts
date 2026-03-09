import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import postgres from 'postgres';

export type Sql = ReturnType<typeof postgres>;

const PG_DATABASE = 'yoizen';

@Injectable()
export class TenantConnectionManager implements OnModuleDestroy {
  private readonly logger = new Logger(TenantConnectionManager.name);
  private readonly pools = new Map<string, Sql>();
  private readonly initialized = new Set<string>();

  private readonly port = Number(process.env.POSTGRES_PORT) || 5432;
  private readonly username = process.env.POSTGRES_USER ?? 'yoizen';
  private readonly password = process.env.POSTGRES_PASSWORD ?? 'yoizen-dev-password';
  private readonly env = process.env.PLATFORM_ENVIRONMENT ?? 'dev';

  getConnection(tenantId: string): Sql {
    let pool = this.pools.get(tenantId);
    if (pool) return pool;

    const host = `postgres.${tenantId}-${this.env}-ns.svc.cluster.local`;
    pool = postgres({
      host,
      port: this.port,
      database: PG_DATABASE,
      username: this.username,
      password: this.password,
      max: 10,
      idle_timeout: 30,
      connect_timeout: 30,
    });
    this.pools.set(tenantId, pool);
    this.logger.log(`Created connection pool for tenant '${tenantId}' -> ${host}/${PG_DATABASE}`);
    return pool;
  }

  isInitialized(tenantId: string): boolean {
    return this.initialized.has(tenantId);
  }

  markInitialized(tenantId: string): void {
    this.initialized.add(tenantId);
  }

  async onModuleDestroy(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const pool of this.pools.values()) {
      tasks.push(pool.end());
    }
    await Promise.all(tasks);
    this.pools.clear();
    this.initialized.clear();
  }
}
