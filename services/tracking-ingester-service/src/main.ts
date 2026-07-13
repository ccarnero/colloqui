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
  resolveClaimCheckEnvelope,
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
  type ObjectStore,
} from "nats";
import postgres from "postgres";
import { applySchema } from "./lib/apply-schema.js";
import type { PayloadRow } from "./lib/build-payload-query.js";
import type { RunRootRow } from "./lib/build-run-root-query.js";
import {
  consumeEvents,
  makeTrackedEventHandler,
  type TrackedConsumerSpec,
} from "./lib/consume-events.js";
import { emitOtelSpans } from "./lib/emit-otel-spans.js";
import { handleChainRequest } from "./lib/handle-chain-request.js";
import { handleEventsRequest } from "./lib/handle-events-request.js";
import { handlePayloadRequest } from "./lib/handle-payload-request.js";
import { handleRunRequest } from "./lib/handle-run-request.js";
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
import { matchChainRoute } from "./lib/match-chain-route.js";
import { matchPayloadRoute } from "./lib/match-payload-route.js";
import { matchRunRoute } from "./lib/match-run-route.js";
import {
  normalizeChainEventRow,
  type RawChainEventRow,
} from "./lib/normalize-chain-event-row.js";
import {
  normalizeChainSpanRow,
  type RawChainSpanRow,
} from "./lib/normalize-chain-span-row.js";
import {
  normalizeEventsRow,
  type RawEventRow,
} from "./lib/normalize-events-row.js";
import {
  normalizeRunEventRow,
  type RawRunEventRow,
} from "./lib/normalize-run-event-row.js";
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

  // Applied in order: the base table first, then the span-pairing view (T01 of
  // trace-console) that reads FROM tracking.tracked_events — the view
  // definition would fail if the table did not exist yet. Mirrors
  // src/scripts/apply-schema.ts.
  const sqlPaths = [
    fileURLToPath(new URL("./sql/tracked-events.sql", import.meta.url)),
    fileURLToPath(new URL("./sql/span-pairs.sql", import.meta.url)),
  ];
  const statements = sqlPaths.flatMap((sqlPath) =>
    loadSchemaStatements(readFileSync(sqlPath, "utf8"))
  );
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

  // Claim-check resolution at ingest (SPEC.md payload-capture T02). Lazy
  // per-bucket Object Store cache — mirrors
  // `MultiTenantConsumerManager.getClaimCheckStore` (open-only, the producer
  // owns bucket creation).
  const claimCheckStores = new Map<string, ObjectStore>();
  const getClaimCheckStore = async (bucket: string): Promise<ObjectStore> => {
    const cached = claimCheckStores.get(bucket);
    if (cached) {
      return cached;
    }
    const store = await js.views.os(bucket);
    claimCheckStores.set(bucket, store);
    return store;
  };
  line(
    `claim-check resolution at ingest ENABLED — timeout_ms=${config.claimCheckResolveTimeoutMs}`
  );

  const handler = makeTrackedEventHandler({
    buffer,
    metrics,
    logger,
    claimCheck: {
      resolve: (envelope) =>
        resolveClaimCheckEnvelope(envelope, getClaimCheckStore),
      timeoutMs: config.claimCheckResolveTimeoutMs,
    },
  });

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
      // Never resolve claim-checks in the manager's middleware: this
      // service runs DLQ-disabled with unbounded maxDeliver (see above), so
      // a resolve-then-nak in `wrapHandler` would turn an expired
      // `payload_ref` into an infinite poison-message loop and the event
      // row would never be persisted (SPEC.md payload-capture binding
      // constraint: claim-check resolution NEVER blocks ingestion). The
      // slim envelope reaches `makeTrackedEventHandler` untouched, which
      // does its own best-effort resolution via `claimCheck.resolve` above
      // and persists slim + 'unresolved' on failure instead of nak-ing.
      resolveClaimChecks: false,
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

  // 7. Health endpoint (readiness semantics) + chains read endpoint (T02 of
  // trace-console). Query execution is the only I/O in this router — the
  // route match (`matchChainRoute`) and the tenant/404 orchestration
  // (`handleChainRequest`) are pure functions from src/lib.
  const server = Bun.serve({
    port: config.port,
    fetch(request): Response | Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        const health = buildHealthResponse(readiness);
        return Response.json(health.body, { status: health.status });
      }

      const chainRoute =
        request.method === "GET" ? matchChainRoute(url.pathname) : null;
      if (chainRoute) {
        const tenant = request.headers.get("x-yoizen-tenant");
        line(
          `GET /chains/${chainRoute.correlationId} — tenant=${tenant ?? "MISSING"}`
        );
        return handleChainRequest(chainRoute.correlationId, tenant, {
          // Normalize driver rows before they reach the pure response
          // shaping (`toChainResponse`): `postgres` returns `timestamptz`
          // columns as `Date` objects and `duration_ms` (numeric/bigint) as
          // a string — both get coerced here, at the I/O boundary, per
          // T02 defects 1 and 2 (attempt 2 live smoke test).
          queryEvents: async (query) => {
            const rows = await sql.unsafe<RawChainEventRow[]>(query.text, [
              ...query.params,
            ]);
            return rows.map(normalizeChainEventRow);
          },
          querySpans: async (query) => {
            const rows = await sql.unsafe<RawChainSpanRow[]>(query.text, [
              ...query.params,
            ]);
            return rows.map(normalizeChainSpanRow);
          },
          log: line,
        }).then((result) =>
          Response.json(result.body, { status: result.status })
        );
      }

      // T04 of manual-loops/payload-capture.md: payload read endpoint.
      // Route match (`matchPayloadRoute`) and the tenant/status orchestration
      // (`handlePayloadRequest`) are pure functions from src/lib; the
      // `sql.unsafe(...)` round trip below is the only I/O.
      const payloadRoute =
        request.method === "GET" ? matchPayloadRoute(url.pathname) : null;
      if (payloadRoute) {
        const tenant = request.headers.get("x-yoizen-tenant");
        line(
          `GET /chains/${payloadRoute.correlationId}/events/${payloadRoute.eventId}/payload — tenant=${tenant ?? "MISSING"}`
        );
        return handlePayloadRequest(
          payloadRoute.correlationId,
          payloadRoute.eventId,
          tenant,
          {
            queryPayload: async (query) => {
              return sql.unsafe<PayloadRow[]>(query.text, [...query.params]);
            },
            log: line,
          }
        ).then((result) =>
          Response.json(result.body, { status: result.status })
        );
      }

      // T01 of manual-loops/run-view.md: workflow run read endpoint. Route
      // match (`matchRunRoute`) and the tenant/root/404 orchestration
      // (`handleRunRequest`) are pure functions from src/lib; the
      // `sql.unsafe(...)` round trips below are the only I/O.
      const runRoute =
        request.method === "GET" ? matchRunRoute(url.pathname) : null;
      if (runRoute) {
        const tenant = request.headers.get("x-yoizen-tenant");
        line(
          `GET /runs/${runRoute.workflowId}/${runRoute.runId} — tenant=${tenant ?? "MISSING"}`
        );
        return handleRunRequest(runRoute.workflowId, runRoute.runId, tenant, {
          queryRoot: async (query) => {
            return sql.unsafe<RunRootRow[]>(query.text, [...query.params]);
          },
          // Normalize driver rows before they reach the pure response
          // shaping (`toRunResponse`), same `Date`/numeric coercion as the
          // chains route.
          queryEvents: async (query) => {
            const rows = await sql.unsafe<RawRunEventRow[]>(query.text, [
              ...query.params,
            ]);
            return rows.map(normalizeRunEventRow);
          },
          querySpans: async (query) => {
            const rows = await sql.unsafe<RawChainSpanRow[]>(query.text, [
              ...query.params,
            ]);
            return rows.map(normalizeChainSpanRow);
          },
          log: line,
        }).then((result) =>
          Response.json(result.body, { status: result.status })
        );
      }

      // T03 of manual-loops/connector-trace-linking.md: events-by-type/
      // resource read endpoint (connector "Recent calls" and any future
      // entity "recent activity" panel). Static path — no dynamic-segment
      // route matcher needed, same as `/health`. Query params are read here
      // (the only I/O edge) and handed to the pure `handleEventsRequest`.
      if (request.method === "GET" && url.pathname === "/events") {
        const tenant = request.headers.get("x-yoizen-tenant");
        const searchParams = url.searchParams;
        line(
          `GET /events — tenant=${tenant ?? "MISSING"} type=${searchParams.get("type") ?? "-"} resource=${searchParams.get("resource") ?? "-"} from=${searchParams.get("from") ?? "-"} limit=${searchParams.get("limit") ?? "-"}`
        );
        return handleEventsRequest(
          tenant,
          {
            type: searchParams.get("type"),
            resource: searchParams.get("resource"),
            from: searchParams.get("from"),
            limit: searchParams.get("limit"),
          },
          {
            // Normalize driver rows before they reach the pure response
            // shaping (`toEventsResponse`), same `Date`/numeric coercion as
            // the chains/run routes.
            queryEvents: async (query) => {
              const rows = await sql.unsafe<RawEventRow[]>(query.text, [
                ...query.params,
              ]);
              return rows.map(normalizeEventsRow);
            },
            log: line,
          }
        ).then((result) =>
          Response.json(result.body, { status: result.status })
        );
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
