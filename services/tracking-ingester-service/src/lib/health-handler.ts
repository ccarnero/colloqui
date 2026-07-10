// Readiness-model + pure health-response builder for the tracking ingester (T08).
//
// The service exposes a single `GET /health` used as a Kubernetes readiness
// probe (SPEC.md T09 wires the probe). Readiness semantics: the pod is only
// "ready" once NATS is connected, Postgres is connected, AND the durable
// consumers have been started — i.e. it can actually ingest. Any component down
// → 503 so the probe holds traffic/rollout back.
//
// Pure function: it maps a snapshot of the readiness flags to an HTTP status +
// JSON body with zero side effects, so `src/main.ts` owns the mutable state and
// this stays trivially unit-testable.

/** Live readiness snapshot the composition edge mutates as startup progresses. */
export interface ReadinessState {
  /** NATS connection established (and not closed). */
  readonly natsConnected: boolean;
  /** Postgres connection verified (e.g. `SELECT 1`). */
  readonly postgresConnected: boolean;
  /** Every durable consumer group has started. */
  readonly consumersStarted: boolean;
}

/** HTTP-shaped result the server serializes verbatim. */
export interface HealthResponse {
  readonly status: number;
  readonly body: {
    readonly status: "ok" | "unavailable";
    readonly checks: ReadinessState;
  };
}

/**
 * Maps a readiness snapshot to a `/health` response: `200 ok` only when every
 * component is up, otherwise `503 unavailable` echoing the per-check flags so
 * the failing component is visible in the probe body.
 */
export function buildHealthResponse(state: ReadinessState): HealthResponse {
  const ready =
    state.natsConnected && state.postgresConnected && state.consumersStarted;

  return {
    status: ready ? 200 : 503,
    body: {
      status: ready ? "ok" : "unavailable",
      checks: {
        natsConnected: state.natsConnected,
        postgresConnected: state.postgresConnected,
        consumersStarted: state.consumersStarted,
      },
    },
  };
}
