import "../pin-storage-engine";

import { randomBytes, randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { Sql } from "@yoizen/database";
import {
  AGENT_ADMIN_AGENT_PUBLISHED,
  AGENT_ADMIN_AGENT_UNPUBLISHED,
  AGENT_ADMIN_CONFIG_SYNC,
  AGENT_ADMIN_JOB_TRIGGER,
  AGENT_ADMIN_PRODUCER,
  AUTOMATION_DOMAIN,
  buildPlatformSubject,
  type EventEnvelope,
  PLATFORM_ACCOUNT_ID,
  PLATFORM_CHANNEL,
  PLATFORM_PROVIDER,
  tenantPostgresDatabaseName,
} from "@yoizen/shared";
import type {
  JetStreamClient,
  JetStreamManager,
  NatsConnection,
  Subscription,
} from "nats";
import postgres from "postgres";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { AppModule } from "../../src/app.module";
import { LAZY_NATS, NatsPublisher } from "../../src/providers/nats.provider";
import { initAgentAdminTenantSchema } from "../../src/providers/schema-initializer";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import {
  calculateChecksum,
  serializeCanonicalPayload,
} from "../../src/utils/payload-utils";

/**
 * `pgvector/pgvector:pg16` (not plain `postgres:16-alpine`) because the
 * canonical tenant DDL runs `CREATE EXTENSION IF NOT EXISTS vector` for the
 * knowledge-base embedding tables. Same image family `tenant-service` uses to
 * provision real tenant databases (`DEFAULT_TENANT_POSTGRES_IMAGE`).
 */
const POSTGRES_IMAGE = "pgvector/pgvector:pg16";

/**
 * Postgres logs the ready banner TWICE: once for the bootstrap/init-scripts
 * server that is then shut down, once for the real one. Waiting for a single
 * occurrence hands back a container whose listener is about to disappear.
 */
const POSTGRES_READY_LOG = /database system is ready to accept connections/;
const POSTGRES_READY_LOG_OCCURRENCES = 2;
const POSTGRES_STARTUP_TIMEOUT_MS = 120_000;

const POSTGRES_DATABASE = "yoizen";
const POSTGRES_USERNAME = "yoizen";
const POSTGRES_PASSWORD = "yoizen-test-password";

/**
 * Tables the e2e suites write to. `agent_versions` is listed explicitly even
 * though `CASCADE` would reach it through its FK to `agents` — naming it keeps
 * Postgres from emitting a `truncate cascades to ...` NOTICE on every
 * `beforeEach`. `credentials`/`channels` are gone: the specs that used them
 * were retired in T01c and nothing in `src/` reads `channels` as a table.
 */
const TRUNCATABLE_TABLES = [
  "agents",
  "agent_versions",
  "jobs",
  "job_executions",
  "config_files",
] as const;

export interface TestContext {
  postgresContainer: StartedTestContainer;
  postgresPort: number;
  postgresHost: string;
  postgresDatabase: string;
  postgresUsername: string;
  postgresPassword: string;
  /** Maintenance pool on the bootstrap database — used to `CREATE DATABASE`. */
  adminSql: Sql;
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
  }
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
  const container = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_USER: POSTGRES_USERNAME,
      POSTGRES_PASSWORD: POSTGRES_PASSWORD,
      POSTGRES_DB: POSTGRES_DATABASE,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(POSTGRES_READY_LOG, POSTGRES_READY_LOG_OCCURRENCES)
    )
    .withStartupTimeout(POSTGRES_STARTUP_TIMEOUT_MS)
    .start();

  const port = container.getMappedPort(5432);
  const host = container.getHost();

  const adminSql = postgres({
    host,
    port,
    database: POSTGRES_DATABASE,
    username: POSTGRES_USERNAME,
    password: POSTGRES_PASSWORD,
    max: 2,
    idle_timeout: 10,
    connect_timeout: 10,
  });

  return {
    postgresContainer: container,
    postgresPort: port,
    postgresHost: host,
    postgresDatabase: POSTGRES_DATABASE,
    postgresUsername: POSTGRES_USERNAME,
    postgresPassword: POSTGRES_PASSWORD,
    adminSql,
    sqlConnections: new Map(),
    natsEvents: [],
    tenantSchemas: new Map(),
  };
}

/**
 * Crea una conexión SQL para un tenant específico.
 *
 * Cada tenant recibe su PROPIA base de datos (`tenant_<id>`), igual que en
 * producción: `TenantConnectionManager.buildSharedTarget` resuelve el pool con
 * `tenantPostgresDatabaseName(tenantId)`. El aislamiento multi-tenant de este
 * servicio es por base de datos, no por columna — compartir una sola base aquí
 * volvería inútiles los tests de aislamiento.
 */
export async function createTenantConnection(
  context: TestContext,
  tenantId: string
): Promise<Sql> {
  const cached = context.tenantSchemas.get(tenantId);
  if (cached) {
    return cached;
  }

  const database = tenantPostgresDatabaseName(tenantId);
  await context.adminSql.unsafe(`CREATE DATABASE "${database}"`);

  const sql = postgres({
    host: context.postgresHost,
    port: context.postgresPort,
    database,
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
 * Inicializa el schema para un tenant específico.
 *
 * Delega en {@link initAgentAdminTenantSchema}, el MISMO DDL que
 * `YoizenclawTenantConnectionManagerPostgres` corre para un tenant real, para
 * que el schema del e2e no pueda volver a quedar retrasado respecto del
 * producto (le faltaban `knowledge_base_ids`, `input_variables`,
 * `output_variables`, `enabled_tools` y `agent_versions`).
 */
export async function initializeTenantSchema(
  context: TestContext,
  tenantId: string
): Promise<Sql> {
  const sql = await createTenantConnection(context, tenantId);
  await initAgentAdminTenantSchema(tenantId, sql);
  return sql;
}

/**
 * Helper para crear un tenant de prueba con schema inicializado
 */
export async function createTestTenant(
  context: TestContext,
  tenantId: string
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
  prefix = "test-tenant"
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
  tenantId: string
): Promise<void> {
  const sql = context.tenantSchemas.get(tenantId);
  if (!sql) {
    return;
  }

  await sql.unsafe(
    `TRUNCATE TABLE ${TRUNCATABLE_TABLES.join(", ")} RESTART IDENTITY CASCADE`
  );
}

/**
 * Doble del {@link YoizenclawTenantConnectionManager} real apuntando al
 * testcontainer. Solo cuatro métodos porque son los únicos que consume `src/`:
 * `ensureSchema`, `getKnownTenantIds`, `probeFirstPool` y `evictTenant`.
 */
export function createMockTenantConnectionManager(
  tenantId: string,
  sql: Sql
): Record<string, unknown> {
  return {
    ensureSchema: async (): Promise<Sql> => sql,
    getConnection: (): Sql => sql,
    getKnownTenantIds: (): string[] => [tenantId],
    probeFirstPool: async (): Promise<boolean> => {
      await sql`SELECT 1`;
      return true;
    },
    evictTenant: async (): Promise<void> => {},
    onModuleDestroy: async (): Promise<void> => {},
  };
}

/**
 * Suscripción NATS falsa que permanece abierta hasta `unsubscribe()`.
 *
 * NO puede completarse de inmediato: `TenantDeletionEvictionListener.consume`
 * vuelve a suscribirse en cuanto el iterador termina (`attempt = 0; continue`),
 * así que un iterador vacío convierte el listener en un bucle caliente que
 * cuelga el proceso de tests.
 */
function createMockSubscription(): Subscription {
  let release: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    unsubscribe: (): void => {
      release();
    },
    async *[Symbol.asyncIterator]() {
      await closed;
    },
  } as unknown as Subscription;
}

/**
 * Doble de `LazyNatsConnection`.
 *
 * Obligatorio: `jetStreamManagerProvider`/`jetStreamClientProvider` son
 * factories `Promise<...>` que Nest resuelve durante `app.init()`, y
 * `JobExecutionStatusConsumer.onModuleInit` hace `await getConnection()` — con
 * el proveedor real, `app.init()` se bloquea 10s marcando al broker ausente y
 * después revienta.
 */
export function createMockLazyNats(): Record<string, unknown> {
  const connection = {
    subscribe: (): Subscription => createMockSubscription(),
    close: async (): Promise<void> => {},
  } as unknown as NatsConnection;

  return {
    getConnection: async (): Promise<NatsConnection> => connection,
    jetstreamManager: async (): Promise<JetStreamManager> =>
      ({}) as JetStreamManager,
    jetstream: async (): Promise<JetStreamClient> => ({}) as JetStreamClient,
    close: async (): Promise<void> => {},
  };
}

/**
 * Levanta el `AppModule` completo tal como lo hace producción:
 * `bootstrapSplitService` -> `bootstrapFastifyApp` = FastifyAdapter +
 * `ValidationPipe` con `whitelist`/`forbidNonWhitelisted`/`transform`/
 * `enableImplicitConversion` (packages/observability/src/bootstrap-fastify.ts).
 * Con `createNestApplication()` a secas se levantaba Express sin pipes, así que
 * ninguna aserción de 400 medía lo que corre en producción.
 */
export async function createE2eApp(options: {
  natsPublisher: unknown;
  sql: Sql;
  tenantId: string;
}): Promise<NestFastifyApplication> {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(YoizenclawTenantConnectionManager)
    .useValue(createMockTenantConnectionManager(options.tenantId, options.sql))
    .overrideProvider(LAZY_NATS)
    .useValue(createMockLazyNats())
    .overrideProvider(NatsPublisher)
    .useValue(options.natsPublisher)
    .compile();

  const app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter()
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    })
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/**
 * Mock de NATS Publisher que captura eventos en memoria
 */
export function createMockNatsPublisher(context: TestContext) {
  return {
    publishAgentPublished: async (
      tenantId: string,
      agentId: string,
      name: string
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
          source: "agent-admin-service/admin/agents/publish",
        }
      );
      context.natsEvents.push(event);
      return { seq: context.natsEvents.length };
    },

    publishAgentUnpublished: async (
      tenantId: string,
      agentId: string,
      name: string
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
          source: "agent-admin-service/admin/agents/unpublish",
        }
      );
      context.natsEvents.push(event);
      return { seq: context.natsEvents.length };
    },

    publishRuntimeConfigSync: async (
      tenantId: string,
      files: Array<{ path: string; content: string; format: string }>,
      deletePaths: string[] = []
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
          source: "agent-admin-service/admin/config-files/deploy",
        }
      );
      context.natsEvents.push(event);
      return { seq: context.natsEvents.length };
    },

    /**
     * Firma de OBJETO, igual que `NatsPublisher.publishJobTrigger`. El doble
     * anterior tomaba posicionales `(tenantId, jobId, executionId, payload)`
     * mientras `JobsService.trigger`/`run` ya llamaban con un objeto, así que
     * capturaba `tenantId = { ... }` y el resto `undefined`.
     */
    publishJobTrigger: async (options: {
      tenantId: string;
      jobId: string;
      executionId: string;
      eventPayload: Record<string, unknown>;
    }) => {
      const triggeredAt = new Date().toISOString();
      const event = createCapturedEvent(
        "job.trigger",
        options.tenantId,
        {
          eventPayload: options.eventPayload,
          executionId: options.executionId,
          jobId: options.jobId,
          triggeredAt,
        },
        {
          correlationId: `job:${options.jobId}:execution:${options.executionId}`,
          occurredAt: triggeredAt,
          resource: `tenant/${options.tenantId}/jobs/${options.jobId}/executions/${options.executionId}`,
          source: "agent-admin-service/admin/jobs/trigger",
        }
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
  await context.adminSql.end();

  // Detener el container de PostgreSQL
  await context.postgresContainer.stop();
}

/**
 * Obtiene eventos NATS filtrados por tipo
 */
export function getEventsByType(
  context: TestContext,
  eventType: string
): NatsEvent[] {
  return context.natsEvents.filter(
    (event) => event.eventName === eventType || event.type === eventType
  );
}

/**
 * Obtiene el último evento NATS de un tipo específico
 */
export function getLastEventByType(
  context: TestContext,
  eventType: string
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
