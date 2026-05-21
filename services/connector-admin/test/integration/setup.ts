/**
 * Integration-test harness for `adapter-service` Phase 6 (durable lifecycle,
 * zero-loss chaos drill, SIGTERM drain). Co-located minimal helpers — kept
 * out of `packages/testing/` because they pull `testcontainers` (a
 * Docker-only dep) which we do NOT want as a transitive devDep of every
 * service. The audit / event-processor specs do NOT use testcontainers
 * yet — they rely on a side-channel docker-compose — so we cannot reuse
 * their harness either.
 *
 * Public surface:
 *   • startNatsTestcontainer(): starts `nats:2.10` with JetStream enabled
 *     and returns the dynamic `nats://host:port` URL plus a stop hook.
 *   • startPostgresTestcontainer(): starts `postgres:16-alpine` with the
 *     `http_adapters` schema applied — enough columns for `upsertMirror`
 *     / `deleteMirrorByServiceName` (zero-loss chaos drill in 6.2).
 *   • createTenantStream(): JetStream `streams.add` for `INGRESS-<tenant>`
 *     with the canonical `evt.<tenant>.>` subject filter.
 *   • publishUpserted/Deleted(): emits a registry-shape envelope on the
 *     correct subject and returns the PubAck (so callers can assert the
 *     stream sequence on chaos paths).
 *
 * Big-O: every helper is O(1) per invocation modulo the underlying Docker
 * / network round-trip; container startup is amortised across all tests
 * sharing a single `IntegrationContext` (one `beforeAll`).
 */

import { randomBytes } from "node:crypto";
import postgres from "postgres";
/**
 * Direct path import of an existing test-only cache reset helper that
 * is intentionally NOT re-exported from `@yoizen/database`'s public
 * barrel (`src/index.ts`). The helper exists *for* this kind of suite
 * but the package owners chose not to graduate it to public surface.
 *
 * Why we need it:
 *   `nats-durable-consumer.ts` keeps a module-level
 *   `Map<"<stream>::<durable>", true>` so steady-state callers (NATS
 *   consumer runners across O(thousands) of pods) short-circuit the
 *   ensure path on the second hit. In integration tests every spec
 *   spawns its OWN ephemeral NATS testcontainer with the SAME stream
 *   names (`INGRESS-ACME`, `INGRESS-GLOBEX`) — so without an explicit
 *   cache reset the first spec ensures the durable on container A,
 *   container A is torn down with the spec, container B starts fresh,
 *   and the cache hits cause `ensureDurableConsumer` to skip — leaving
 *   the durable absent on container B and `js.consumers.get` failing
 *   with `consumer not found`.
 *
 * The function is already `__`-prefixed + `ForTests`-suffixed so the
 * test-only intent is unambiguous. Importing via the relative source
 * path keeps the package's public surface unchanged.
 */
import { __resetEnsuredConsumerCacheForTests } from "../../../../packages/database/src/nats-durable-consumer";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import {
  AckPolicy,
  connect,
  DeliverPolicy,
  ReplayPolicy,
  RetentionPolicy,
  headers as natsHeaders,
  nanos,
  type ConsumerInfo,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  type PubAck,
} from "nats";
import {
  buildRegistryPlatformSubject,
  CHANNEL_STREAM_MAX_AGE_NS,
  CHANNEL_STREAM_MAX_BYTES,
  getTenantStreamName,
  getTenantSubjectPattern,
  PLATFORM_KIND_SERVICE_DELETED,
  PLATFORM_KIND_SERVICE_UPSERTED,
  PLATFORM_RESOURCE_SERVICE,
  REGISTRY_EVENT_SOURCE,
  SERVICE_DELETED_EVENT_TYPE,
  SERVICE_UPSERTED_EVENT_TYPE,
  type EventEnvelope,
  type IServiceConfigDeletedPayload,
  type IServiceConfigUpsertedPayload,
} from "@yoizen/shared";

export interface NatsTestcontainer {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly container: StartedTestContainer;
  readonly stop: () => Promise<void>;
}

/**
 * Boots `nats:2.10` with JetStream (`-js`) on a dynamic host port.
 *
 * The image is pulled lazily on the first call; subsequent calls in the
 * same test process reuse the cached layer. `Wait.forLogMessage` blocks
 * until the broker logs `Server is ready` — this is the canonical NATS
 * readiness signal and avoids the `connect()` race that bites test
 * suites which only wait on the TCP port being open.
 *
 * Resource limits are deliberately generous (default `--storage`,
 * default `--memory`); the suites in Phase 6 publish only ~100 events.
 */
export async function startNatsTestcontainer(): Promise<NatsTestcontainer> {
  const container = await new GenericContainer("nats:2.10")
    .withCommand(["-js", "-DV", "-m", "8222"])
    .withExposedPorts(4222, 8222)
    .withWaitStrategy(Wait.forLogMessage(/Server is ready/))
    .withStartupTimeout(60_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(4222);
  return {
    url: `nats://${host}:${port}`,
    host,
    port,
    container,
    stop: async () => {
      await container.stop({ timeout: 5 });
    },
  };
}

export interface PostgresTestcontainer {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  readonly container: StartedTestContainer;
  readonly stop: () => Promise<void>;
}

/**
 * Schema for the `http_adapters` mirror table consumed by `upsertMirror`
 * / `deleteMirrorByServiceName`. Inlined here (not imported from a
 * migration) because the per-tenant Postgres schema in production is
 * managed by `@yoizen/database` migrations + per-tenant pools, and we
 * want this harness to be standalone — pulling the migration runner here
 * would couple every adapter integration test to the tenant migration
 * pipeline, which is overkill for the mirror columns we actually need.
 *
 * Only columns referenced by `adapters.repository.ts:upsertMirror`
 * (lines 251-305) and `deleteMirrorByServiceName` (311-323) are
 * materialised — anything beyond would create unused state and inflate
 * the per-test container size.
 */
const HTTP_ADAPTERS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS http_adapters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    context TEXT NOT NULL DEFAULT 'internal',
    base_url TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'none',
    auth_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    headers JSONB NOT NULL DEFAULT '[]'::jsonb,
    default_cache_strategy JSONB,
    timeout_ms INTEGER NOT NULL DEFAULT 30000,
    max_retries INTEGER NOT NULL DEFAULT 0,
    retry_backoff_ms INTEGER NOT NULL DEFAULT 0,
    health_check_path TEXT NOT NULL DEFAULT '/health',
    is_encrypted BOOLEAN NOT NULL DEFAULT false,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    managed_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_http_adapters_managed_by ON http_adapters(managed_by);
`;

/**
 * Boots `postgres:16-alpine` with the `http_adapters` mirror schema
 * applied. The `tenant` boundary in production is the **database**
 * itself (per-tenant pool), so each integration spec that needs more
 * than one tenant should call {@link createTenantDatabase} per tenant.
 */
export async function startPostgresTestcontainer(): Promise<PostgresTestcontainer> {
  const username = "yoizen";
  const password = "yoizen-test-password";
  const database = "yoizen";

  const container = await new GenericContainer("postgres:16-alpine")
    .withEnvironment({
      POSTGRES_USER: username,
      POSTGRES_PASSWORD: password,
      POSTGRES_DB: database,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(
        /database system is ready to accept connections/,
        2,
      ),
    )
    .withStartupTimeout(60_000)
    .start();

  return {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database,
    username,
    password,
    container,
    stop: async () => {
      await container.stop({ timeout: 5 });
    },
  };
}

/**
 * Provisions a fresh tenant database (`tenant_<id>`) on the running
 * Postgres container and runs the mirror schema in it. Uses an O(1)
 * SQL connection (`maxConnections=1`) for the bootstrap step then
 * returns a fresh pool sized to the test workload.
 */
export async function createTenantDatabase(
  pg: PostgresTestcontainer,
  tenantId: string,
): Promise<{ readonly databaseName: string; readonly sql: postgres.Sql }> {
  const databaseName = `tenant_${tenantId.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
  const admin = postgres({
    host: pg.host,
    port: pg.port,
    database: pg.database,
    username: pg.username,
    password: pg.password,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });
  try {
    /**
     * `CREATE DATABASE` cannot run in a transaction — `postgres.js`
     * still wraps tagged-template queries by default. We use `unsafe`
     * with explicit string interpolation (validated above by the
     * regex-strip) to bypass that.
     */
    const safe = databaseName.replace(/[^a-z0-9_]/g, "");
    await admin.unsafe(`CREATE DATABASE ${safe}`).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already exists")) throw err;
    });
  } finally {
    await admin.end({ timeout: 1 });
  }

  const sql = postgres({
    host: pg.host,
    port: pg.port,
    database: databaseName,
    username: pg.username,
    password: pg.password,
    max: 5,
    idle_timeout: 5,
    connect_timeout: 10,
  });
  await sql.unsafe(HTTP_ADAPTERS_SCHEMA_SQL);
  return { databaseName, sql };
}

export interface NatsClients {
  readonly nc: NatsConnection;
  readonly jsm: JetStreamManager;
  readonly js: JetStreamClient;
}

/**
 * Returns a fresh `(nc, jsm, js)` tuple bound to the given URL. Caller
 * MUST call `nc.close()` in a `finally` / `afterAll` to avoid
 * dangling NATS subscriptions that hold the testcontainer alive.
 */
export async function connectNats(url: string): Promise<NatsClients> {
  const nc = await connect({ servers: url, maxReconnectAttempts: 5 });
  const jsm = await nc.jetstreamManager();
  const js = nc.jetstream();
  return { nc, jsm, js };
}

/**
 * Idempotently creates the per-tenant `INGRESS-<TENANT>` stream with
 * the canonical `evt.<tenant>.>` subject filter and the platform's
 * standard retention/age/byte limits. Mirrors the production helper
 * `ensureTenantIngressStream` but runs against the testcontainer JSM
 * directly so the test does not depend on the publisher being wired.
 */
export async function createTenantStream(
  jsm: JetStreamManager,
  tenantId: string,
): Promise<string> {
  const name = getTenantStreamName(tenantId);
  try {
    await jsm.streams.info(name);
    return name;
  } catch {
    // not found — create
  }
  await jsm.streams.add({
    name,
    subjects: [getTenantSubjectPattern(tenantId)],
    retention: RetentionPolicy.Limits,
    max_age: CHANNEL_STREAM_MAX_AGE_NS,
    max_bytes: CHANNEL_STREAM_MAX_BYTES,
  });
  return name;
}

interface IBuildEnvelopeOptions {
  readonly tenantId: string;
  readonly subjectTenant?: string;
  readonly type:
    | typeof SERVICE_UPSERTED_EVENT_TYPE
    | typeof SERVICE_DELETED_EVENT_TYPE;
  readonly payload:
    | IServiceConfigUpsertedPayload
    | IServiceConfigDeletedPayload;
  readonly idempotencyKey?: string;
}

function buildEnvelope(opts: IBuildEnvelopeOptions): EventEnvelope {
  const idempotencykey =
    opts.idempotencyKey ?? `evt-${randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();
  return {
    specversion: "1.0",
    id: `id-${idempotencykey}`,
    source: REGISTRY_EVENT_SOURCE,
    type: opts.type,
    resource: `tenant/${opts.tenantId}/service/${(opts.payload as { serviceId?: string }).serviceId ?? "svc"}`,
    time: now,
    traceid: randomBytes(16).toString("hex"),
    causation_id: null,
    correlation_id: idempotencykey,
    tenant: opts.tenantId,
    producer: "registry-service",
    domain: "platform",
    channel: PLATFORM_RESOURCE_SERVICE,
    provider: "system",
    accountid: opts.tenantId,
    idempotencykey,
    transport: { method: "stream", protocol: "internal", depth: 1 },
    data: {
      received_at: now,
      payload_inline: true,
      payload_ref: null,
      payload_bytes: 0,
      payload_checksum: "",
      payload: opts.payload as unknown as Record<string, unknown>,
    },
  };
}

export interface PublishOptions {
  readonly tenantId: string;
  readonly subjectTenant?: string;
  readonly payload:
    | IServiceConfigUpsertedPayload
    | IServiceConfigDeletedPayload;
  readonly idempotencyKey?: string;
}

/**
 * Publishes a `service.upserted.v1` envelope on the canonical subject
 * `evt.<subjectTenant>.registry-service.platform.service.system.upserted.v1`.
 * `subjectTenant` defaults to `tenantId`; pass a different value to
 * exercise the cross-tenant tripwire (REQ-ASIS-006).
 */
export async function publishUpserted(
  js: JetStreamClient,
  opts: PublishOptions,
): Promise<PubAck> {
  const subjectTenant = opts.subjectTenant ?? opts.tenantId;
  const subject = buildRegistryPlatformSubject(
    subjectTenant,
    PLATFORM_RESOURCE_SERVICE,
    PLATFORM_KIND_SERVICE_UPSERTED,
  );
  const envelope = buildEnvelope({
    tenantId: opts.tenantId,
    subjectTenant,
    type: SERVICE_UPSERTED_EVENT_TYPE,
    payload: opts.payload,
    idempotencyKey: opts.idempotencyKey,
  });
  const hdrs = natsHeaders();
  hdrs.set("Nats-Msg-Id", envelope.idempotencykey);
  return js.publish(subject, encodeJson(envelope), {
    headers: hdrs,
    msgID: envelope.idempotencykey,
  });
}

export async function publishDeleted(
  js: JetStreamClient,
  opts: PublishOptions,
): Promise<PubAck> {
  const subjectTenant = opts.subjectTenant ?? opts.tenantId;
  const subject = buildRegistryPlatformSubject(
    subjectTenant,
    PLATFORM_RESOURCE_SERVICE,
    PLATFORM_KIND_SERVICE_DELETED,
  );
  const envelope = buildEnvelope({
    tenantId: opts.tenantId,
    subjectTenant,
    type: SERVICE_DELETED_EVENT_TYPE,
    payload: opts.payload,
    idempotencyKey: opts.idempotencyKey,
  });
  const hdrs = natsHeaders();
  hdrs.set("Nats-Msg-Id", envelope.idempotencykey);
  return js.publish(subject, encodeJson(envelope), {
    headers: hdrs,
    msgID: envelope.idempotencykey,
  });
}

/**
 * Publishes a deliberately malformed (non-JSON) body on the canonical
 * upserted subject — used to exercise the parse-error poison path.
 */
export async function publishMalformed(
  js: JetStreamClient,
  tenantId: string,
): Promise<PubAck> {
  const subject = buildRegistryPlatformSubject(
    tenantId,
    PLATFORM_RESOURCE_SERVICE,
    PLATFORM_KIND_SERVICE_UPSERTED,
  );
  return js.publish(subject, new TextEncoder().encode("{not-json"));
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

/**
 * O(1) helper to inspect the durable's lag without the test having to
 * remember the canonical name across two specs.
 */
export async function getDurableInfo(
  jsm: JetStreamManager,
  stream: string,
  durableName: string,
): Promise<ConsumerInfo> {
  return jsm.consumers.info(stream, durableName);
}

/**
 * Polls a predicate every `intervalMs` up to `timeoutMs`. Returns true
 * on first truthy resolution; throws on timeout. The polling pattern
 * matches the e2e suite's `poll()` helper but is local to integration
 * tests so we do not import from `tests/e2e/`.
 */
export async function waitFor(
  predicate: () => Promise<boolean>,
  opts: { readonly timeoutMs: number; readonly intervalMs?: number },
): Promise<void> {
  const interval = opts.intervalMs ?? 100;
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(Math.min(interval, deadline - Date.now()));
  }
  throw new Error(`waitFor timed out after ${opts.timeoutMs}ms`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Test-only — clears process-wide caches that the production runtime
 * legitimately wants to keep but which leak across testcontainer
 * lifecycles. MUST be called from each Phase-6 spec's `beforeAll`
 * BEFORE any `ensureDurableConsumer` /`MultiTenantConsumerManager.start`
 * runs, otherwise stream-level cache hits from a sibling spec will
 * skip the ensure on a fresh broker (where the durable is absent) and
 * surface as `consumer not found` during `js.consumers.get`.
 *
 * O(1): both backing maps are cleared via `Map.clear()`.
 */
export function resetIntegrationCaches(): void {
  __resetEnsuredConsumerCacheForTests();
}

/**
 * Convenience constants reused across all Phase-6 specs.
 */
export const DURABLE_NAME = "adapter-internal-sync";
export const ACK_WAIT_MS = 60_000;
export const BACKOFF_MS: readonly number[] = [60_000, 120_000, 300_000, 600_000];
export const MAX_DELIVER = 5;

/**
 * Server-side defaults baked into the durable consumer for these tests.
 * Exposed so each spec can issue an `ensureDurableConsumer`-equivalent
 * call without duplicating the literal values from
 * `internal-sync.service.ts`.
 *
 * NOTE: We reuse `nanos`, `AckPolicy`, `DeliverPolicy`, `ReplayPolicy`
 * from the `nats` client at the top of this file so each spec can build
 * a custom consumer when needed (e.g. shorter `ack_wait` for the
 * shutdown-grace test).
 */
export {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  RetentionPolicy,
  nanos,
};
