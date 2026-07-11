// Environment-config loader for the tracking-ingester service (T08).
//
// Pure + Result-typed (SPEC.md code-style contract): reads a plain env bag and
// returns either a fully-resolved `TrackingIngesterConfig` or a structured
// `ConfigError` naming EVERY missing required variable at once (fail-fast at the
// composition edge — see `src/main.ts`). It never throws and never touches
// `process.env` itself, so it is trivially unit-testable with a fake bag.
//
// Repo convention: credentials are NEVER defaulted. `NATS_URL` and the Postgres
// DSN carry credentials, so an unset value is a hard error (missing-name), not a
// silent `localhost` fallback. Non-secret tuning knobs (port, batch, backoff)
// DO carry sensible defaults.

import { err, ok, type Result } from "./result.js";

/** Env var names that supply the Postgres DSN, in precedence order. */
export const POSTGRES_DSN_ENV: readonly string[] = [
  "POSTGRES_URL",
  "DATABASE_URL",
];

/** Fully-resolved, validated runtime configuration. */
export interface TrackingIngesterConfig {
  /** NATS server URL (required — carries credentials, never defaulted). */
  readonly natsUrl: string;
  /** Postgres DSN (required — carries credentials, never defaulted). */
  readonly postgresUrl: string;
  /** HTTP port for the `/health` endpoint. @default 3000 */
  readonly port: number;
  /** Max unacked in-flight messages per durable (backpressure). @default 1000 */
  readonly maxAckPending: number;
  /** Rows coalesced per insert round trip. @default 100 */
  readonly batchSize: number;
  /** Max time a partial batch waits before flushing (ms). @default 1000 */
  readonly batchFlushMs: number;
  /**
   * Concurrent handler invocations per tenant runner. Defaulted to `batchSize`
   * so a size-triggered flush is actually reachable: with the runner's default
   * concurrency of 1 the buffer only ever holds a single row (the serial loop
   * awaits each commit before pulling the next message), which defeats
   * batching. @default = batchSize
   */
  readonly concurrency: number;
  /**
   * Max delivery attempts before the server stops redelivering.
   * `-1` = unlimited. Defaulted to unlimited because our own consumers run with
   * DLQ DISABLED (SPEC.md T07): a bounded `maxDeliver` would SILENTLY DROP a
   * tracking row after a transient Postgres outage exhausted the retries, and
   * the ingester's whole contract is to persist every event. @default -1
   */
  readonly maxDeliver: number;
  /**
   * Redelivery backoff schedule (ms). The first element also becomes the
   * effective ack-wait window (NATS overrides `ack_wait` when `backoff` is set),
   * so it MUST comfortably exceed `batchFlushMs` + insert latency or in-flight
   * messages get spuriously redelivered. @default [30s, 60s, 120s, 300s]
   */
  readonly backoffMs: readonly number[];
  /**
   * Whether OTel span export (T2 of trace-visualization) is on. @default false
   * — export is opt-in so existing deployments are unaffected until the
   * collector pipeline (T3) is provisioned.
   */
  readonly otelExportEnabled: boolean;
  /**
   * OTLP/HTTP JSON traces endpoint (the in-cluster otel-collector), e.g.
   * `http://otel-collector.observability:4318/v1/traces`. `undefined` when
   * export is disabled — `emit-otel-spans.ts` treats that as a no-op emitter.
   * Required (hard error) when `otelExportEnabled` is true; never defaulted
   * when required, matching the credential-like-knobs convention above.
   */
  readonly otelExporterOtlpEndpoint: string | undefined;
  /**
   * Claim-check resolution budget at ingest (SPEC.md payload-capture T02) —
   * bounds how long `resolve-payload.ts` waits on the Object Store fetch
   * before treating it as a failure (`payload_status = "unresolved"`).
   * Ingestion latency is the priority, so this is deliberately bounded, never
   * unlimited. @default 2000
   */
  readonly claimCheckResolveTimeoutMs: number;
}

/** Structured validation failure listing every missing required env name. */
export interface ConfigError {
  readonly missing: readonly string[];
  readonly message: string;
}

/** Default redelivery backoff — first step (30s) >> batchFlushMs (1s). */
const DEFAULT_BACKOFF_MS: readonly number[] = [
  30_000, 60_000, 120_000, 300_000,
];

type EnvBag = Readonly<Record<string, string | undefined>>;

function readTrimmed(env: EnvBag, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** Resolves the Postgres DSN from the precedence list, or `undefined`. */
function resolvePostgresUrl(env: EnvBag): string | undefined {
  for (const name of POSTGRES_DSN_ENV) {
    const value = readTrimmed(env, name);
    if (value) {
      return value;
    }
  }
  return undefined;
}

/**
 * Parses an integer env var. When `positive` is set, a parsed value <= 0 is
 * rejected the same way a non-numeric one is (falls back), so tuning knobs that
 * only make sense as positive counts can never be zeroed/negated by a typo.
 * `maxDeliver` deliberately does NOT pass `positive` — `-1` (unlimited) is valid.
 */
function readInt(
  env: EnvBag,
  name: string,
  fallback: number,
  positive = false
): number {
  const raw = readTrimmed(env, name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  if (positive && parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/** Parses a boolean env var (`"true"`/`"1"` → true; anything else → `fallback`). */
function readBool(env: EnvBag, name: string, fallback: boolean): boolean {
  const raw = readTrimmed(env, name);
  if (raw === undefined) {
    return fallback;
  }
  return raw.toLowerCase() === "true" || raw === "1";
}

/**
 * Parses a comma-separated positive-integer ms list (e.g. `"5000,10000"`) for
 * the redelivery backoff schedule. Mirrors `readInt`'s fallback convention: on
 * ANY malformed element (non-numeric, non-positive) or an empty list the whole
 * value is rejected and `fallback` is returned — a partially-parsed backoff
 * schedule is never surfaced.
 */
function readIntList(
  env: EnvBag,
  name: string,
  fallback: readonly number[]
): readonly number[] {
  const raw = readTrimmed(env, name);
  if (raw === undefined) {
    return fallback;
  }
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length === 0 || parts.some((p) => p === "")) {
    return fallback;
  }
  const parsed: number[] = [];
  for (const part of parts) {
    const value = Number.parseInt(part, 10);
    if (Number.isNaN(value) || value <= 0 || String(value) !== part) {
      return fallback;
    }
    parsed.push(value);
  }
  return parsed;
}

/**
 * Validates `env` and returns a resolved config or the list of missing
 * required variables. Credentials (`NATS_URL`, Postgres DSN) are mandatory;
 * everything else has a non-secret default.
 */
export function loadTrackingIngesterConfig(
  env: EnvBag,
  log: (message: string) => void = () => {}
): Result<TrackingIngesterConfig, ConfigError> {
  const missing: string[] = [];

  const natsUrl = readTrimmed(env, "NATS_URL");
  if (!natsUrl) {
    missing.push("NATS_URL");
  }

  const postgresUrl = resolvePostgresUrl(env);
  if (!postgresUrl) {
    // Report the whole precedence set so operators know either satisfies it.
    missing.push(
      `${POSTGRES_DSN_ENV[0]} (or ${POSTGRES_DSN_ENV.slice(1).join(" / ")})`
    );
  }

  // OTel export is opt-in (default disabled). Only when explicitly enabled does
  // the endpoint become required — an unset endpoint on a disabled emitter is
  // NOT an error (matches T2: "disabled = no-op emitter").
  const otelExportEnabled = readBool(env, "OTEL_EXPORT_ENABLED", false);
  const otelExporterOtlpEndpoint = readTrimmed(
    env,
    "OTEL_EXPORTER_OTLP_ENDPOINT"
  );
  if (otelExportEnabled && !otelExporterOtlpEndpoint) {
    missing.push(
      "OTEL_EXPORTER_OTLP_ENDPOINT (required when OTEL_EXPORT_ENABLED=true)"
    );
  }

  if (missing.length > 0) {
    return err<ConfigError>({
      missing,
      message: `Missing required env — set: ${missing.join(", ")}`,
    });
  }

  const batchSize = readInt(env, "TRK_BATCH_SIZE", 100, true);
  const maxAckPending = readInt(env, "TRK_MAX_ACK_PENDING", 1_000);
  const requestedConcurrency = readInt(env, "TRK_CONCURRENCY", batchSize, true);

  // Invariant: concurrency <= maxAckPending. Both are independent env overrides,
  // so a mis-set pair could ask the runner to hold more in-flight handlers than
  // the server will leave unacked — silently starving throughput. Clamp + log.
  let concurrency = requestedConcurrency;
  if (concurrency > maxAckPending) {
    log(
      `TRK_CONCURRENCY (${concurrency}) exceeds TRK_MAX_ACK_PENDING (${maxAckPending}); clamping to ${maxAckPending}`
    );
    concurrency = maxAckPending;
  }

  return ok({
    natsUrl: natsUrl!,
    postgresUrl: postgresUrl!,
    port: readInt(env, "PORT", 3000),
    maxAckPending,
    batchSize,
    batchFlushMs: readInt(env, "TRK_BATCH_FLUSH_MS", 1_000),
    concurrency,
    maxDeliver: readInt(env, "TRK_MAX_DELIVER", -1),
    backoffMs: readIntList(env, "TRK_BACKOFF_MS", DEFAULT_BACKOFF_MS),
    otelExportEnabled,
    otelExporterOtlpEndpoint,
    claimCheckResolveTimeoutMs: readInt(
      env,
      "CLAIM_CHECK_RESOLVE_TIMEOUT_MS",
      2_000,
      true
    ),
  });
}
