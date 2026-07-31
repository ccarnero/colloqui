# `@yoizen/observability`

Logging, tracing, metrics and process bootstrap for every Node/Bun service on
the platform. Importing this package is how a service gets a correlated
`traceId` in its logs, OTLP export, HTTP/NATS metrics, and the api/worker
bootstrap split — without re-deriving any of it locally.

Workspace package, no build step: `main`/`types` both point at `src/index.ts`
(`package.json:5-8`). NestJS is a **peer** dependency (`package.json:10-14`), so
the package does not pin the host's Nest version.

## Bootstrap and the api/worker split

Every service is deployed twice from one image — a Knative Service (`*-api`)
serving HTTP and a plain Deployment (`*-worker`) driving NATS consumers — with
the entry point branching on `SERVICE_MODE` (`src/runtime-mode.ts:2-13`).

```ts
await bootstrapSplitService({ baseServiceName, module, port, apiOptions });
```

`src/bootstrap-split-service.ts:39` picks the path (`:45-69`):

- `worker` → `bootstrapWorkerApp` — a Nest **standalone** context with no HTTP
  server, plus a Node-native readiness server on the same `port` exposing
  `/health`, `/healthz` and `/readyz` and answering **503 until init completes**
  (`src/bootstrap-worker.ts:25`, `:53-58`), and a shutdown handler
  (`src/bootstrap-split-service.ts:50-58`).
- anything else → `bootstrapFastifyApp` + a SIGTERM telemetry flush handler
  (`:60-69`).

It returns a discriminated union `{ mode: "api" | "worker", app }` so callers
can introspect the mode.

### Mode resolution

`serviceMode()` (`src/runtime-mode.ts:29-34`) reads `SERVICE_MODE` **once** and
memoizes it. The value is trimmed and lowercased; anything outside
`{"api","worker"}` — including unset — falls back to `api`, so a typo silently
runs the pod as an API rather than failing loudly (`:17`, `:31-32`). The
`api` default is deliberate backwards-compat for single-pod services (`:22-24`).

`isWorkerMode()` / `isApiMode()` (`:37-44`) are the O(1) predicates consumers
use inside `onModuleInit` to decide whether to actually consume. **The split
bootstrap does not disable consumers by itself** — each consumer checks the
predicate (typically as `ensureOnly: !isWorkerMode()`).

### Service naming

`resolveServiceName(base)` (`src/runtime-mode.ts:57-67`) prefers
`OTEL_SERVICE_NAME` when set by the manifest, else falls back to
`"<base>-<mode>"`, keeping Prometheus/Tempo/Loki labels aligned with the
deployment role. Memoized in a `Map` (`:55`, `:58-59`).

> Note the asymmetry: `bootstrapSplitService` builds its logger name as
> `"<base>-<mode>"` directly (`src/bootstrap-split-service.ts:46`) rather than
> going through `resolveServiceName`, so an `OTEL_SERVICE_NAME` override is
> reflected in telemetry but not in that bootstrap log line.

`__resetServiceModeCacheForTests()` (`src/runtime-mode.ts:73-76`) clears both
caches; it is test-only by contract (`:69-72`).

## Logging

`PinoLoggerService` (`src/logger.ts:29`) implements Nest's `LoggerService` over
`createPinoLogger` (`:13-27`):

- Level from `LOG_LEVEL`, default `info` (`:16`).
- ISO timestamps (`:25`) and a `level` field emitted as the label, not the
  numeric code (`:17-21`).
- **Every line carries the active trace context.** The pino `mixin` (`:22-24`)
  calls `traceContext()` (`:5-11`), which injects `traceId`/`spanId` from the
  active OTel span — and returns `{}` for the all-zero invalid trace id (`:9`),
  so logs outside a trace stay clean instead of carrying a fake id.

`src/envelope-logging.ts` adds envelope-aware helpers: `envelopeLogFields`
(`:45`), `logWithEnvelope` (`:97`) and `activeOrRandomTraceId` (`:116`).

## Tracing and metrics

| Helper | Purpose |
|---|---|
| `initTelemetry(options)` (`src/telemetry.ts:28`) | OTLP trace + metric export; endpoint from `OTEL_EXPORTER_OTLP_ENDPOINT`, default `http://localhost:4318` (`:33`). Installs `AsyncLocalStorageContextManager` (`:49`) so context propagates across `await` |
| `initServiceTelemetry(defaultServiceName)` (`src/telemetry.ts:82`) | Service-level wrapper that resolves the name through `resolveServiceName`, preferring `OTEL_SERVICE_NAME` (`:77-81`) |
| `getTracer(name)` / `getMeter(name)` (`src/telemetry.ts:101`, `:105`) | Accessors |
| `tracedFetch(input, init)` (`src/traced-fetch.ts:11`) | `fetch` wrapper producing an `HTTP <METHOD>` client span (`:20`) under tracer `http-client` (`:9`) and injecting trace headers (`:28-30`) |
| `registerHttpMetricsHooks(fastify, serviceName)` (`src/http-metrics.ts:13`) | Fastify request/duration metrics |
| `createNatsConsumerMetrics(...)` (`src/nats-consumer-metrics.ts:63`) | Consumer metric sink passed to `MultiTenantConsumerManager` |
| `createCircuitBreakerMetrics(...)` (`src/circuit-breaker-metrics.ts:47`) | Breaker state/trip metrics |
| `injectTraceContext` / `extractTraceContext` / `startNatsConsumerSpan` / `startNatsProducerSpan` (`src/nats-propagation.ts:34`, `:38`, `:42`, `:58`) | W3C trace context across NATS headers, so a bus hop does not break the trace |
| `startWorkerHealthServer(port)` (`src/worker-health-server.ts:60`) | Health endpoint for non-HTTP worker pods |

Both metric factories expose a `__reset*CacheForTests()` companion
(`src/nats-consumer-metrics.ts:135`, `src/circuit-breaker-metrics.ts:107`).

## Environment Variables

The package reads exactly four (`rg -o 'process\.env\.[A-Z_0-9]+' packages/observability/src | sort -u`):

| Variable | Default | Description |
|---|---|---|
| `SERVICE_MODE` | `api` | `api` or `worker`; invalid values fall back to `api` (`src/runtime-mode.ts:31-32`) |
| `OTEL_SERVICE_NAME` | `"<base>-<mode>"` | Overrides the resolved telemetry service name (`src/runtime-mode.ts:60-64`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector (`src/telemetry.ts:33`) |
| `LOG_LEVEL` | `info` | pino level (`src/logger.ts:16`) |

## Testing

`test/unit/` holds the suites; the package declares no `test` script, so run
them from the repo root with your usual Bun invocation, e.g.:

```bash
bun test packages/observability/test/unit
```
