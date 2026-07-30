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
 *   • startMongoTestcontainer(): starts `mongo:7` with the
 *     `http_adapters` / `adapter_endpoints` collections applied via
 *     {@link applyMongoSchema} — enough for `upsertMirror`
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
import { Socket } from "node:net";
import { MongoClient, type Db } from "mongodb";
import { applyMongoSchema } from "@yoizen/database";
import { ADAPTER_MONGO_SCHEMA } from "@yoizen/shared";
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
  await waitForHostPortConnectable(host, port);
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

export interface MongoTestcontainer {
  readonly uri: string;
  readonly host: string;
  readonly port: number;
  readonly container: StartedTestContainer;
  readonly stop: () => Promise<void>;
}

/**
 * Boots `mongo:7` on a dynamic host port and waits for the canonical
 * "Waiting for connections" readiness log line.
 */
export async function startMongoTestcontainer(): Promise<MongoTestcontainer> {
  const container = await new GenericContainer("mongo:7")
    .withExposedPorts(27017)
    .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
    .withStartupTimeout(60_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(27017);
  await waitForHostPortConnectable(host, port);
  return {
    uri: `mongodb://${host}:${port}`,
    host,
    port,
    container,
    stop: async () => {
      await container.stop({ timeout: 5 });
    },
  };
}

export interface TenantMongoDatabase {
  readonly databaseName: string;
  readonly db: Db;
  readonly client: MongoClient;
}

/**
 * Provisions a fresh tenant database on the running Mongo container and
 * applies {@link ADAPTER_MONGO_SCHEMA}.
 */
export async function createTenantMongoDatabase(
  mongo: MongoTestcontainer,
  tenantId: string,
): Promise<TenantMongoDatabase> {
  const client = new MongoClient(mongo.uri, { maxPoolSize: 5 });
  await client.connect();
  const databaseName = `tenant_${tenantId.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
  const db = client.db(databaseName);
  await applyMongoSchema(db, ADAPTER_MONGO_SCHEMA);
  return { databaseName, db, client };
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

/** Interval between host-port connect probes (ms). */
const HOST_PORT_PROBE_INTERVAL_MS = 10;
/** Per-probe socket timeout (ms) — a refusal is normally instant. */
const HOST_PORT_PROBE_TIMEOUT_MS = 1_000;
/** Ceiling for the whole host-port readiness gate (ms). */
const HOST_PORT_READY_TIMEOUT_MS = 30_000;

/**
 * Blocks until a TCP connect to `host:port` succeeds — i.e. until the
 * *host side* of the container's port mapping is actually accepting
 * connections.
 *
 * Why this exists (flaky-suite RCA): both `startNatsTestcontainer` and
 * `startMongoTestcontainer` wait on `Wait.forLogMessage(...)`, and that
 * line is emitted by the process INSIDE the container. The container
 * runtime publishes the `host:<ephemeral>` → `container:<port>` proxy
 * asynchronously, so `container.start()` can resolve a few ms BEFORE
 * the mapped port accepts anything. Every spec here dials the broker
 * from `beforeAll` the instant `start()` returns, so the very first
 * `connect()` intermittently died with `ECONNREFUSED` /
 * `NatsError: CONNECTION_REFUSED` — bun reports that as a failing
 * `(unnamed)` hook. Measured locally: after the readiness LINE, the
 * mapped port was NOT yet connectable on 5 of 6 container boots,
 * lagging 2–14ms.
 *
 * We cannot delegate to testcontainers' own `Wait.forListeningPorts()`
 * (which performs exactly this host-port check): it *also* runs three
 * `docker exec` probes per poll against the container-internal port,
 * and those execs never return under this container runtime — the
 * composite strategy hangs past the startup budget (verified: the
 * host-port half logged `complete`, the internal half never did). So
 * we replicate only the host-side half here.
 *
 * This is a wait on the real signal (a successful TCP connect), not a
 * fixed sleep: it returns on the first successful probe and throws
 * loudly if the port never opens.
 *
 * O(1) memory; O(elapsed / interval) probes — typically 1–2.
 *
 * @throws when the port still refuses connections after `timeoutMs`.
 */
export async function waitForHostPortConnectable(
  host: string,
  port: number,
  timeoutMs: number = HOST_PORT_READY_TIMEOUT_MS,
): Promise<void> {
  const startedAt = Date.now();
  let attempts = 0;
  while (Date.now() - startedAt < timeoutMs) {
    attempts++;
    if (await isPortConnectable(host, port)) {
      // Only noisy when the port was NOT ready on the first probe —
      // that is precisely the race this gate absorbs, so surface it.
      if (attempts > 1) {
        console.log(
          `[integration-setup] host port ${host}:${port} accepted a connection after ${attempts} probes / ${Date.now() - startedAt}ms (mapping published late)`,
        );
      }
      return;
    }
    await sleep(HOST_PORT_PROBE_INTERVAL_MS);
  }
  const message = `[integration-setup] host port ${host}:${port} never accepted a connection within ${timeoutMs}ms (${attempts} probes)`;
  console.error(message);
  throw new Error(message);
}

/**
 * One non-throwing TCP connect attempt. Resolves `true` on connect,
 * `false` on refusal / timeout / any socket error. The socket is always
 * destroyed, so no probe can leak a handle and keep the process alive.
 */
export function isPortConnectable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const settle = (connectable: boolean): void => {
      socket.destroy();
      resolve(connectable);
    };
    socket.setTimeout(HOST_PORT_PROBE_TIMEOUT_MS);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
    socket.connect(port, host);
  });
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
