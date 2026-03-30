import { GenericContainer, type StartedTestContainer, type Wait } from 'testcontainers';
import postgres from 'postgres';
import type { Sql } from '../src/providers/tenant-connection-manager';

// Schema SQL para inicializar las tablas
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

  CREATE TABLE IF NOT EXISTS channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('webchat', 'whatsapp', 'telegram', 'slack', 'custom')),
    config JSONB NOT NULL DEFAULT '{}',
    webhook_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_channels_type ON channels(type);

  CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

export interface TestContext {
  postgresContainer: StartedTestContainer;
  postgresPort: number;
  postgresHost: string;
  postgresDatabase: string;
  postgresUsername: string;
  postgresPassword: string;
  sqlConnections: Map<string, Sql>;
  natsEvents: NatsEvent[];
  tenantSchemas: Map<string, Sql>;
}

export interface NatsEvent {
  subject: string;
  type: string;
  payload: Record<string, unknown>;
  metadata: {
    tenantId: string;
    timestamp: number;
    source: string;
  };
}

export interface TestTenant {
  id: string;
  sql: Sql;
}

/**
 * Inicializa PostgreSQL testcontainer con schema completo
 */
export async function setupPostgres(): Promise<TestContext> {
  const container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'yoizen',
      POSTGRES_PASSWORD: 'yoizen-test-password',
      POSTGRES_DB: 'yoizen',
    })
    .withExposedPorts(5432)
    .withStartupTimeout(60000)
    .start();

  const port = container.getMappedPort(5432);
  const host = container.getHost();

  return {
    postgresContainer: container,
    postgresPort: port,
    postgresHost: host,
    postgresDatabase: 'yoizen',
    postgresUsername: 'yoizen',
    postgresPassword: 'yoizen-test-password',
    sqlConnections: new Map(),
    natsEvents: [],
    tenantSchemas: new Map(),
  };
}

/**
 * Crea una conexión SQL para un tenant específico
 */
export function createTenantConnection(
  context: TestContext,
  tenantId: string,
): Sql {
  if (context.tenantSchemas.has(tenantId)) {
    return context.tenantSchemas.get(tenantId)!;
  }

  const sql = postgres({
    host: context.postgresHost,
    port: context.postgresPort,
    database: context.postgresDatabase,
    username: context.postgresUsername,
    password: context.postgresPassword,
    max: 5,
    idle_timeout: 10,
    connect_timeout: 10,
  });

  context.tenantSchemas.set(tenantId, sql);
  return sql;
}

/**
 * Inicializa el schema para un tenant específico
 */
export async function initializeTenantSchema(
  context: TestContext,
  tenantId: string,
): Promise<Sql> {
  const sql = createTenantConnection(context, tenantId);
  await sql.unsafe(SCHEMA_SQL);
  return sql;
}

/**
 * Helper para crear un tenant de prueba con schema inicializado
 */
export async function createTestTenant(
  context: TestContext,
  tenantId: string,
): Promise<TestTenant> {
  const sql = await initializeTenantSchema(context, tenantId);
  return {
    id: tenantId,
    sql,
  };
}

/**
 * Crea múltiples tenants de prueba
 */
export async function createTestTenants(
  context: TestContext,
  count: number,
  prefix = 'test-tenant',
): Promise<TestTenant[]> {
  const tenants: TestTenant[] = [];
  for (let i = 1; i <= count; i++) {
    const tenant = await createTestTenant(context, `${prefix}-${i}`);
    tenants.push(tenant);
  }
  return tenants;
}

/**
 * Limpia todas las tablas para un tenant (útil entre tests)
 */
export async function cleanupTenantTables(
  context: TestContext,
  tenantId: string,
): Promise<void> {
  const sql = context.tenantSchemas.get(tenantId);
  if (!sql) return;

  await sql`
    TRUNCATE TABLE agents, credentials, channels, jobs, job_executions, config_files 
    RESTART IDENTITY CASCADE;
  `;
}

/**
 * Mock de NATS Publisher que captura eventos en memoria
 */
export function createMockNatsPublisher(context: TestContext) {
  return {
    publishAgentPublished: async (
      tenantId: string,
      agentId: string,
      name: string,
    ) => {
      const event: NatsEvent = {
        subject: 'events.agent.published',
        type: 'agent.published',
        payload: {
          agentId,
          name,
          publishedAt: new Date().toISOString(),
          status: 'published',
        },
        metadata: {
          tenantId,
          timestamp: Date.now(),
          source: 'admin-service',
        },
      };
      context.natsEvents.push(event);
      return { seq: context.natsEvents.length };
    },

    publishAgentUnpublished: async (
      tenantId: string,
      agentId: string,
      name: string,
    ) => {
      const event: NatsEvent = {
        subject: 'events.agent.unpublished',
        type: 'agent.unpublished',
        payload: {
          agentId,
          name,
          unpublishedAt: new Date().toISOString(),
          status: 'draft',
        },
        metadata: {
          tenantId,
          timestamp: Date.now(),
          source: 'admin-service',
        },
      };
      context.natsEvents.push(event);
      return { seq: context.natsEvents.length };
    },

    publishCredentialRotated: async (
      tenantId: string,
      credentialId: string,
      credentialType: string,
    ) => {
      const event: NatsEvent = {
        subject: 'events.credential.rotated',
        type: 'credential.rotated',
        payload: {
          credentialId,
          type: credentialType,
          rotatedAt: new Date().toISOString(),
        },
        metadata: {
          tenantId,
          timestamp: Date.now(),
          source: 'admin-service',
        },
      };
      context.natsEvents.push(event);
      return { seq: context.natsEvents.length };
    },

    publishChannelConfigChanged: async (
      tenantId: string,
      channelId: string,
      channelType: string,
      changes: Record<string, unknown>,
    ) => {
      const event: NatsEvent = {
        subject: 'events.channel.config.changed',
        type: 'channel.config.changed',
        payload: {
          channelId,
          channelType,
          changes,
          changedAt: new Date().toISOString(),
        },
        metadata: {
          tenantId,
          timestamp: Date.now(),
          source: 'admin-service',
        },
      };
      context.natsEvents.push(event);
      return { seq: context.natsEvents.length };
    },

    publishRuntimeConfigSync: async (
      tenantId: string,
      files: Array<{ path: string; content: string; format: string }>,
      deletePaths: string[] = [],
    ) => {
      const event: NatsEvent = {
        subject: 'events.runtime.config.sync',
        type: 'runtime.config.sync',
        payload: {
          files,
          deletePaths,
          syncedAt: new Date().toISOString(),
        },
        metadata: {
          tenantId,
          timestamp: Date.now(),
          source: 'admin-service',
        },
      };
      context.natsEvents.push(event);
      return { seq: context.natsEvents.length };
    },

    publishJobTrigger: async (
      tenantId: string,
      jobId: string,
      executionId: string,
      eventPayload: Record<string, unknown>,
    ) => {
      const event: NatsEvent = {
        subject: 'events.job.trigger',
        type: 'job.trigger',
        payload: {
          jobId,
          executionId,
          eventPayload,
          triggeredAt: new Date().toISOString(),
        },
        metadata: {
          tenantId,
          timestamp: Date.now(),
          source: 'admin-service',
        },
      };
      context.natsEvents.push(event);
      return { seq: context.natsEvents.length };
    },
  };
}

/**
 * Limpia el contexto de test (cierra conexiones y detiene containers)
 */
export async function teardownTestContext(context: TestContext): Promise<void> {
  // Cerrar todas las conexiones SQL
  for (const sql of context.tenantSchemas.values()) {
    await sql.end();
  }
  context.tenantSchemas.clear();

  // Detener el container de PostgreSQL
  await context.postgresContainer.stop();
}

/**
 * Obtiene eventos NATS filtrados por tipo
 */
export function getEventsByType(
  context: TestContext,
  eventType: string,
): NatsEvent[] {
  return context.natsEvents.filter((e) => e.type === eventType);
}

/**
 * Obtiene el último evento NATS de un tipo específico
 */
export function getLastEventByType(
  context: TestContext,
  eventType: string,
): NatsEvent | undefined {
  const events = getEventsByType(context, eventType);
  return events.length > 0 ? events[events.length - 1] : undefined;
}

/**
 * Limpia todos los eventos NATS capturados
 */
export function clearNatsEvents(context: TestContext): void {
  context.natsEvents.length = 0;
}
