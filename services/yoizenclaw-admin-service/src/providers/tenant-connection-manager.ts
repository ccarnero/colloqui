import {
  Injectable,
  OnModuleDestroy,
  Logger,
  Inject,
  Optional,
  forwardRef,
} from '@nestjs/common';
import postgres from 'postgres';
import { SEED_SERVICE } from './provider-tokens';
import type { SeedService } from '../db/seed.service';

export type Sql = ReturnType<typeof postgres>;

const PG_DATABASE = 'yoizen';
type SeedServicePort = Pick<SeedService, 'runSeed'>;

@Injectable()
export class TenantConnectionManager implements OnModuleDestroy {
  private readonly logger = new Logger(TenantConnectionManager.name);
  private readonly pools = new Map<string, Sql>();
  private readonly initializedSchemas = new Set<string>();
  private readonly seededTenants = new Set<string>();

  private readonly port = Number(process.env.POSTGRES_PORT) || 5432;
  private readonly username = process.env.POSTGRES_USER ?? 'yoizen';
  private readonly password = process.env.POSTGRES_PASSWORD ?? 'yoizen-dev-password';
  private readonly env = process.env.PLATFORM_ENVIRONMENT ?? 'dev';

  constructor(
    @Optional()
    @Inject(forwardRef(() => SEED_SERVICE))
    private readonly seedService?: SeedServicePort,
  ) {}

  /**
   * Obtiene o crea una conexión SQL para un tenant específico.
   * Implementa lazy initialization con Map<string, Sql>.
   */
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

  /**
   * Verifica si el schema del tenant ya ha sido inicializado.
   */
  isSchemaInitialized(tenantId: string): boolean {
    return this.initializedSchemas.has(tenantId);
  }

  /**
   * Marca el schema de un tenant como inicializado.
   */
  markSchemaInitialized(tenantId: string): void {
    this.initializedSchemas.add(tenantId);
  }

  /**
   * Asegura que el schema de un tenant esté inicializado.
   * Ejecuta las migraciones/schema creation y el seed si es necesario.
   */
  async ensureSchema(tenantId: string): Promise<void> {
    if (this.isSchemaInitialized(tenantId)) {
      return;
    }

    const sql = this.getConnection(tenantId);

    await sql`
      CREATE TABLE IF NOT EXISTS agents (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        system_prompt TEXT NOT NULL,
        model_config JSONB NOT NULL DEFAULT '{}',
        tools JSONB DEFAULT '[]',
        channels JSONB DEFAULT '[]',
        status VARCHAR(50) DEFAULT 'draft',
        is_active BOOLEAN DEFAULT true,
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
      CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at DESC);

      CREATE TABLE IF NOT EXISTS credentials (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('api_key', 'oauth', 'basic', 'custom')),
        value TEXT NOT NULL,
        is_encrypted BOOLEAN DEFAULT false,
        metadata JSONB DEFAULT '{}',
        expires_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        agent_id UUID NOT NULL REFERENCES agents(id),
        schedule VARCHAR(255) NOT NULL,
        payload JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        last_run TIMESTAMPTZ,
        next_run TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_agent_id ON jobs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(is_active) WHERE is_active = true;

      CREATE TABLE IF NOT EXISTS job_executions (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES jobs(id),
        status VARCHAR(50) NOT NULL,
        event_payload JSONB DEFAULT '{}',
        result JSONB,
        logs TEXT[],
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        triggered_by VARCHAR(50),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS config_files (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        path TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        format VARCHAR(10) NOT NULL CHECK (format IN ('yaml', 'json')),
        version INTEGER DEFAULT 1,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    this.markSchemaInitialized(tenantId);
    this.logger.log(`Schema initialized for tenant '${tenantId}'`);

    // Ejecutar seed automáticamente si no se ha ejecutado antes
    if (this.seedService && !this.seededTenants.has(tenantId)) {
      try {
        const result = await this.seedService.runSeed(tenantId);
        this.seededTenants.add(tenantId);
        this.logger.log(
          `Seed completed for tenant '${tenantId}': ${result.agents} agents, ${result.jobs} jobs created`,
        );
      } catch (error) {
        this.logger.error(`Failed to seed tenant '${tenantId}':`, error);
        // No lanzamos error para no bloquear la inicialización del schema
      }
    }
  }

  /**
   * Cierra todas las conexiones de pools activos.
   */
  async closeAll(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const pool of this.pools.values()) {
      tasks.push(pool.end());
    }
    await Promise.all(tasks);
    this.pools.clear();
    this.initializedSchemas.clear();
    this.seededTenants.clear();
    this.logger.log('All connection pools closed');
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeAll();
  }
}
