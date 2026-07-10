// Composition edge for @yoizen/tracking-ingester-service (T08).
//
// This is the ONLY file that touches process-level I/O (env, telemetry, NATS,
// Postgres, HTTP). Every unit of logic it wires is a pure/injected function from
// `src/lib/*`; main just resolves config, opens connections, applies the schema,
// starts the durable consumers and serves `/health`. It owns the mutable
// readiness state and the graceful-shutdown sequence.
//
// Startup order (fail-fast at each step):
//   1. Validate env (Result — missing names are fatal, credentials never defaulted)
//   2. initServiceTelemetry
//   3. Connect Postgres + verify (SELECT 1) → applySchema
//   4. Connect NATS → JetStream manager + client
//   5. Build the batching buffer + shared handler
//   6. Start the durable consumer groups via the real MultiTenantConsumerManager
//   7. Serve /health (readiness) on the configured port

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Type-only import so the real config we hand to MultiTenantConsumerManager is
// checked against the reuse authority — any drift in field names/semantics
// breaks at compile time with ZERO runtime cost (carry-over T07 review #2).
import type { IMultiTenantConsumerConfig } from "@yoizen/database";
import {
  type INatsConsumerLogger,
  MultiTenantConsumerManager,
} from "@yoizen/database";
import {
  initServiceTelemetry,
  PinoLoggerService,
  resolveServiceName,
  shutdownTelemetry,
} from "@yoizen/observability";
import {
  connect,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
} from "nats";
import postgres from "postgres";
import { applySchema } from "./lib/apply-schema.js";
import {
  consumeEvents,
  makeTrackedEventHandler,
  type TrackedConsumerSpec,
} from "./lib/consume-events.js";
import { emitOtelSpans } from "./lib/emit-otel-spans.js";
import {
  buildHealthResponse,
  type ReadinessState,
} from "./lib/health-handler.js";
import {
  type InsertClient,
  insertTrackedEvents,
} from "./lib/insert-tracked-events.js";
import { loadTrackingIngesterConfig } from "./lib/load-config.js";
import { loadSchemaStatements } from "./lib/load-schema-statements.js";
import { toOtelSpan } from "./lib/to-otel-span.js";
import { toSpanSourceRow } from "./lib/to-span-source-row.js";
import type { TrackedEventRow } from "./lib/to-tracked-event-row.js";
import { createTrackedEventBuffer } from "./lib/tracked-event-buffer.js";
import { createTrackingIngesterMetrics } from "./lib/tracking-ingester-metrics.js";

/** Short base name; K8s resource is `tracking-ingester-worker` (SPEC.md T09). */
const BASE_SERVICE_NAME = "tracking-ingester";

async function bootstrap(): Promise<void> {
  const serviceName = resolveServiceName(BASE_SERVICE_NAME);
  const logger = new PinoLoggerService(serviceName);
  const line = (message: string): void => logger.log(message);

  // 1. Env config — Result-validated, fail-fast naming EVERY missing var.
  const configResult = loadTrackingIngesterConfig(process.env, line);
  if (!configResult.ok) {
    logger.error(configResult.error.message);
    process.exit(1);
  }
  const config = configResult.value;

  // 2. Telemetry (metrics/traces exporters). Safe no-op if already initialized.
  initServiceTelemetry(BASE_SERVICE_NAME);
  const metrics = createTrackingIngesterMetrics(serviceName);

  // Never print credentials — only host/db so the operator can confirm target.
  const redactedDsn = config.postgresUrl.replace(/\/\/[^@]*@/, "//***@");
  const redactedNats = config.natsUrl.replace(/\/\/[^@]*@/, "//***@");

  const readiness: ReadinessState = {
    natsConnected: false,
    postgresConnected: false,
    consumersStarted: false,
  };
  // Mutable view — buildHealthResponse reads a fresh snapshot each request.
  const state = readiness as {
    natsConnected: boolean;
    postgresConnected: boolean;
    consumersStarted: boolean;
  };

  // 3. Postgres — connect, verify, apply schema at startup.
  line(`connecting to Postgres ${redactedDsn}`);
  const sql = postgres(config.postgresUrl, {
    max: 10,
    prepare: false,
    onnotice: () => {},
  });
  await sql`SELECT 1`;
  state.postgresConnected = true;
  line("Postgres connected");

  const sqlPath = fileURLToPath(
    new URL("./sql/tracked-events.sql", import.meta.url)
  );
  const statements = loadSchemaStatements(readFileSync(sqlPath, "utf8"));
  const schema = await applySchema(sql, statements, line);
  if (!schema.ok) {
    logger.error(
      `schema apply FAILED at statement #${schema.error.index + 1}: ${schema.error.reason}`
    );
    await sql.end({ timeout: 5 });
    process.exit(1);
  }
  line(`schema applied — ${schema.value.applied} statement(s)`);

  // 4. NATS — connect and open the JetStream manager + client.
  line(`connecting to NATS ${redactedNats}`);
  const nc: NatsConnection = await connect({
    servers: config.natsUrl,
    name: serviceName,
    waitOnFirstConnect: true,
  });
  const jsm: JetStreamManager = await nc.jetstreamManager();
  const js: JetStreamClient = nc.jetstream();
  state.natsConnected = true;
  line("NATS connected");

  // 5. Batching buffer (ack-on-commit) + shared per-message handler.
  // postgres.js `Sql` carries a `Helper` call overload whose `then` is private,
  // so it does not structurally satisfy the minimal `InsertClient` shape (a
  // callable tagged-template + `.array`) even though the real instance does. A
  // narrow wiring-boundary cast bridges the gap; the runtime object is exactly
  // what `insertTrackedEvents` expects.
  const insertClient = sql as unknown as InsertClient;

  // OTel span export (T2 of trace-visualization) — opt-in, fire-and-forget.
  // Disabled (config.otelExporterOtlpEndpoint undefined) → emitOtelSpans is a
  // documented no-op that never touches the network.
  if (config.otelExportEnabled) {
    line(
      `otel span export ENABLED — endpoint ${config.otelExporterOtlpEndpoint}`
    );
  } else {
    line("otel span export disabled (OTEL_EXPORT_ENABLED=false)");
  }
  const emitSpans = (rows: readonly TrackedEventRow[]): Promise<unknown> =>
    emitOtelSpans(
      config.otelExporterOtlpEndpoint,
      rows.map((row) => toOtelSpan(toSpanSourceRow(row))),
      fetch,
      line
    );

  const buffer = createTrackedEventBuffer({
    insert: (rows) => insertTrackedEvents(insertClient, rows, line),
    batchSize: config.batchSize,
    batchFlushMs: config.batchFlushMs,
    log: line,
    emitSpans,
  });
  const handler = makeTrackedEventHandler({ buffer, metrics, logger });

  // Runner logger the manager forwards to each per-tenant runner.
  const runnerLogger: INatsConsumerLogger & {
    log?: (m: string) => void;
    warn?: (m: string) => void;
  } = {
    error: (m) => logger.error(m),
    warn: (m) => logger.warn(m),
    log: (m) => logger.log(m),
  };

  // 6. Start the durable consumer groups via the real manager.
  //
  // ACK-SEMANTICS RELIANCE (carry-over T07 review #1) — decision (a), documented:
  // The T07 handler (`makeTrackedEventHandler`) signals the message ITSELF —
  // `msg.ack()` on a committed insert, `msg.term()` after persisting malformed
  // drift, `msg.nak()` on a transient insert failure — and then returns
  // normally. `NatsConsumerRunner.processOne`
  // (packages/database/src/nats-consumer-runner.ts:491-517) calls `msg.ack()`
  // UNCONDITIONALLY once the handler resolves. That trailing ack is a NO-OP here
  // because nats.js JsMsg is first-signal-wins: the `didAck` guard
  // (node_modules/nats/lib/jetstream/jsmsg.js:104/122) drops any ack/nak/term
  // after the first. We rely on that guard rather than rewriting the committed
  // T07 handler to throw/PermanentError semantics, because option (b) would mean
  // editing committed T07 code AND would lose the "term-after-persist" nuance
  // (the runner's PermanentError path terms WITHOUT our buffered persist). If a
  // future nats.js drops the guard, adapt the handler contract here instead.
  const createManager = (spec: TrackedConsumerSpec) => {
    const managerConfig: IMultiTenantConsumerConfig = {
      streamPattern: spec.streamPattern,
      durableName: spec.durableName,
      description: spec.description,
      maxAckPending: spec.maxAckPending,
      // Unlimited redelivery: our consumers run DLQ-disabled, so a bounded
      // maxDeliver would DROP a tracking row after a Postgres outage exhausted
      // retries. Spaced by backoffMs so a sustained outage does not hammer PG.
      maxDeliver: config.maxDeliver,
      backoffMs: config.backoffMs,
      // Concurrency > 1 is what lets the buffer coalesce rows (see load-config).
      runnerOptions: { concurrency: config.concurrency },
      dlq: spec.dlq,
      ensureOnly: false,
      metrics: undefined,
    };
    return new MultiTenantConsumerManager(
      jsm,
      js,
      managerConfig,
      spec.handler,
      runnerLogger
    );
  };

  const consumers = await consumeEvents({
    createManager,
    handler,
    maxAckPending: config.maxAckPending,
  });
  state.consumersStarted = true;
  line("durable consumers started (trk-* durables reconciling tenant streams)");

  // 7. Health endpoint (readiness semantics).
  const server = Bun.serve({
    port: config.port,
    fetch(request): Response {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        const health = buildHealthResponse(readiness);
        return Response.json(health.body, { status: health.status });
      }
      return new Response("not found", { status: 404 });
    },
  });
  line(`health endpoint listening on :${config.port}/health`);

  // Graceful shutdown: stop consumers, flush buffer, close connections.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    line(`received ${signal} — shutting down`);
    state.consumersStarted = false;
    try {
      await consumers.stop();
      line("consumers stopped");
      await buffer.stop();
      line("buffer flushed");
      await nc.drain();
      state.natsConnected = false;
      await sql.end({ timeout: 5 });
      state.postgresConnected = false;
      await shutdownTelemetry();
      server.stop();
      line("shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error(
        `shutdown error: ${error instanceof Error ? error.message : String(error)}`
      );
      // The shutdown sequence itself failed (drain/flush/close threw) — exit
      // non-zero so the orchestrator sees an unclean stop instead of success.
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

bootstrap().catch((error: unknown) => {
  // Unrecoverable startup failure — log and exit non-zero so K8s restarts us.
  console.error(
    `[tracking-ingester] fatal: ${error instanceof Error ? error.stack : error}`
  );
  process.exit(1);
});
