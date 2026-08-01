import { GenericContainer, type StartedTestContainer } from "testcontainers";
import postgres from "postgres";
import { randomBytes, randomUUID } from "node:crypto";
import type { Sql } from "@yoizen/database";
import {
  PLATFORM_ACCOUNT_ID,
  AGENT_ADMIN_AGENT_PUBLISHED,
  AGENT_ADMIN_AGENT_UNPUBLISHED,
  PLATFORM_CHANNEL,
  AGENT_ADMIN_CONFIG_SYNC,
  AUTOMATION_DOMAIN,
  AGENT_ADMIN_JOB_TRIGGER,
  AGENT_ADMIN_PRODUCER,
  PLATFORM_PROVIDER,
  buildPlatformSubject,
  type EventEnvelope,
} from "@yoizen/shared";
import {
  calculateChecksum,
  serializeCanonicalPayload,
} from "../../src/utils/payload-utils";

// Schema SQL to initialize tables for e2e PostgreSQL
const SCHEMA_SQL = `
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

  CREATE TABLE IF NOT EXISTS channels (
    id UUID PRIMARY KEY,
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

type CapturedEventName =
  | "agent.published"
  | "agent.unpublished"
  | "runtime.config.sync"
  | "job.trigger";

export interface NatsEvent extends EventEnvelope {
  eventName: CapturedEventName;
  subject: string;
  payload: Record<string, unknown>;
  metadata: {
    source: string;
    tenantId: string;
    timestamp: number;
  };
}

const EVENT_TYPES = {
  "agent.published": "io.yoizen.platform.admin.agent.published.v1",
  "agent.unpublished": "io.yoizen.platform.admin.agent.unpublished.v1",
  "runtime.config.sync": "io.yoizen.platform.runtime.config.synced.v1",
  "job.trigger": "io.yoizen.platform.admin.job.triggered.v1",
} as const;

const EVENT_SUBJECTS: Record<CapturedEventName, string> = {
  "agent.published": AGENT_ADMIN_AGENT_PUBLISHED,
  "agent.unpublished": AGENT_ADMIN_AGENT_UNPUBLISHED,
  "runtime.config.sync": AGENT_ADMIN_CONFIG_SYNC,
  "job.trigger": AGENT_ADMIN_JOB_TRIGGER,
};

function createTraceId(): string {
  return randomBytes(16).toString("hex");
}

function createCapturedEvent(
  eventName: CapturedEventName,
  tenantId: string,
  payload: Record<string, unknown>,
  options: {
    correlationId: string;
    occurredAt: string;
    resource: string;
    source: string;
  },
): NatsEvent {
  const time = options.occurredAt;
  const serializedPayload = serializeCanonicalPayload(payload);

  return {
    accountid: PLATFORM_ACCOUNT_ID,
    causation_id: null,
    channel: PLATFORM_CHANNEL,
    correlation_id: options.correlationId,
    data: {
      payload,
      payload_bytes: Buffer.byteLength(serializedPayload, "utf-8"),
      payload_checksum: calculateChecksum(payload),
      payload_inline: true,
      payload_ref: null,
      received_at: time,
    },
    domain: AUTOMATION_DOMAIN,
    eventName,
    id: randomUUID(),
    idempotencykey: calculateChecksum(payload),
    metadata: {
      source: options.source,
      tenantId,
      timestamp: Date.parse(time),
    },
    payload,
    producer: AGENT_ADMIN_PRODUCER,
    provider: PLATFORM_PROVIDER,
    resource: options.resource,
    source: options.source,
    specversion: "1.0",
    subject: buildPlatformSubject(EVENT_SUBJECTS[eventName], tenantId),
    tenant: tenantId,
    time,
    traceid: createTraceId(),
    transport: {
      method: "stream",
      protocol: "internal",
    },
    type: EVENT_TYPES[eventName],
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
  const container = await new GenericContainer("postgres:16-alpine")
    .withEnvironment({
      POSTGRES_USER: "yoizen",
      POSTGRES_PASSWORD: "yoizen-test-password",
      POSTGRES_DB: "yoizen",
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
    postgresDatabase: "yoizen",
    postgresUsername: "yoizen",
    postgresPassword: "yoizen-test-password",
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
  prefix = "test-tenant",
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
      const publishedAt = new Date().toISOString();
      const event = createCapturedEvent(
        "agent.published",
        tenantId,
        {
          agentId,
          name,
          publishedAt,
          status: "published",
        },
        {
          correlationId: `agent:${agentId}`,
          occurredAt: publishedAt,
          resource: `tenant/${tenantId}/agents/${agentId}`,
          source: "//agent-admin-service/admin/agents/publish",
        },
      );
      context.natsEvents.push(event);
      return { seq: context.natsEvents.length };
    },

    publishAgentUnpublished: async (
      tenantId: string,
      agentId: string,
      name: string,
    ) => {
      const unpublishedAt = new Date().toISOString();
      const event = createCapturedEvent(
        "agent.unpublished",
        tenantId,
        {
          agentId,
          name,
          status: "draft",
          unpublishedAt,
        },
        {
          correlationId: `agent:${agentId}`,
          occurredAt: unpublishedAt,
          resource: `tenant/${tenantId}/agents/${agentId}`,
          source: "//agent-admin-service/admin/agents/unpublish",
        },
      );
      context.natsEvents.push(event);
      return { seq: context.natsEvents.length };
    },

    publishRuntimeConfigSync: async (
      tenantId: string,
      files: Array<{ path: string; content: string; format: string }>,
      deletePaths: string[] = [],
    ) => {
      const syncedAt = new Date().toISOString();
      const event = createCapturedEvent(
        "runtime.config.sync",
        tenantId,
        {
          deletePaths,
          files,
          syncedAt,
        },
        {
          correlationId: `runtime:${tenantId}:config`,
          occurredAt: syncedAt,
          resource: `tenant/${tenantId}/runtime/config`,
          source: "//agent-admin-service/admin/config-files/deploy",
        },
      );
      context.natsEvents.push(event);
      return { seq: context.natsEvents.length };
    },

    publishJobTrigger: async (
      tenantId: string,
      jobId: string,
      executionId: string,
      eventPayload: Record<string, unknown>,
    ) => {
      const triggeredAt = new Date().toISOString();
      const event = createCapturedEvent(
        "job.trigger",
        tenantId,
        {
          eventPayload,
          executionId,
          jobId,
          triggeredAt,
        },
        {
          correlationId: `job:${jobId}:execution:${executionId}`,
          occurredAt: triggeredAt,
          resource: `tenant/${tenantId}/jobs/${jobId}/executions/${executionId}`,
          source: "//agent-admin-service/admin/jobs/trigger",
        },
      );
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
  return context.natsEvents.filter(
    (event) => event.eventName === eventType || event.type === eventType,
  );
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
