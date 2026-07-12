// to-run-response.ts — shapes raw run event/span rows (as returned by
// build-run-events-query.ts / build-spans-query.ts, resolved via
// build-run-root-query.ts) into the console-facing run response (T01 of
// manual-loops/run-view.md). Pure function: no I/O, no DB client.
//
// CROSS-RUN-LEAKAGE FIX (attempt 2): `events`/`spans` passed in here are a
// CORRELATION-wide fetch — when multiple runs share one trigger, they
// contain every sibling run's step events/spans too. This function scopes
// down to `(workflowId, runId)`'s OWN run via `scope-run-events.ts` /
// `scope-run-spans.ts` BEFORE computing `summary`/`step_detail`/the
// response `events`/`spans` arrays and the connector/agent cast — only
// `cast`'s channel entry deliberately stays correlation-wide (see
// `aggregate-run-cast.ts`'s header). `correlation_id` is still returned
// verbatim so the console can link to the full (unscoped) chain view.

import { aggregateRunCast, type CastEntry } from "./aggregate-run-cast.js";
import type { RunEventRow } from "./build-run-events-query.js";
import type { ChainSpanRow } from "./build-spans-query.js";
import { scopeRunEvents } from "./scope-run-events.js";
import { scopeRunSpans } from "./scope-run-spans.js";

export type RunStatus = "running" | "completed" | "failed";

export interface RunSummary {
  readonly status: RunStatus;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly total_ms: number;
  readonly steps_ok: number;
  readonly steps_failed: number;
}

export interface RunResponse {
  readonly workflow_id: string;
  readonly run_id: string;
  readonly correlation_id: string;
  readonly tenant: string | null;
  /** The run's OWN events only (cross-run-leakage fix) — never a sibling
   * run's step events, even when they share `correlation_id`. See
   * `scope-run-events.ts`. */
  readonly events: readonly RunEventRow[];
  /** The run's OWN spans only — see `scope-run-spans.ts`. */
  readonly spans: readonly ChainSpanRow[];
  readonly summary: RunSummary;
  readonly cast: readonly CastEntry[];
  /**
   * `false` for a run whose OWN scoped events contain none of the
   * step-level kinds (`action_started`/`action_completed`/
   * `condition_evaluated`) — either a genuinely pre-step-events run (see
   * build-run-root-query.ts's header — those actually 404 before reaching
   * this function, since they never recorded a real workflowId/runId) or a
   * run whose definition has zero actions. SPEC.md T01: "runs with zero
   * step events return step_detail: false".
   */
  readonly step_detail: boolean;
}

const STEP_EVENT_KINDS = new Set([
  "action_started",
  "action_completed",
  "condition_evaluated",
]);

// `execution_completed`'s payload `status` field — see
// build-run-events-query.ts's `payload_step_status` column.
const FAILED_RUN_STATUS = "FAILED";

// `action_completed`'s payload `status` field.
const STEP_STATUS_OK = "ok";
const STEP_STATUS_FAILED = "failed";

/**
 * Shapes the run response for `(workflowId, runId, correlationId, tenant)`
 * from the event and span rows fetched for the run's correlation — which
 * may contain sibling runs' events/spans when the correlation's trigger
 * fired multiple workflows (cross-run-leakage fix, see this file's header).
 *
 * Status derivation (SPEC.md T01, reconciled against the ACTUAL emitted
 * events — see build-run-root-query.ts's header finding: there is no
 * `execution_failed` KIND, only a single `execution_completed` kind whose
 * payload `status` field distinguishes `"COMPLETED"` from `"FAILED"`):
 *   - no `execution_started` OR no `execution_completed` yet -> "running"
 *   - `execution_completed` present, payload status `"FAILED"` -> "failed"
 *   - `execution_completed` present, any other status -> "completed"
 */
export function toRunResponse(
  workflowId: string,
  runId: string,
  correlationId: string,
  tenant: string | null,
  events: readonly RunEventRow[],
  spans: readonly ChainSpanRow[]
): RunResponse {
  const scoped = scopeRunEvents(events, workflowId, runId);
  const runEvents = scoped.runEvents;
  const runSpans = scopeRunSpans(
    spans,
    scoped.startedEvent?.event_id ?? null,
    scoped.executionId
  );

  const startedEvent = runEvents.find(
    (event) => event.kind === "execution_started"
  );
  const completedEvent = runEvents.find(
    (event) => event.kind === "execution_completed"
  );

  let status: RunStatus = "running";
  if (completedEvent) {
    status =
      completedEvent.payload_step_status === FAILED_RUN_STATUS
        ? "failed"
        : "completed";
  }

  let stepsOk = 0;
  let stepsFailed = 0;
  for (const event of runEvents) {
    if (event.kind !== "action_completed") {
      continue;
    }
    if (event.payload_step_status === STEP_STATUS_OK) {
      stepsOk += 1;
    } else if (event.payload_step_status === STEP_STATUS_FAILED) {
      stepsFailed += 1;
    }
  }

  const startedAt = startedEvent?.occurred_at ?? null;
  const completedAt = completedEvent?.occurred_at ?? null;
  const totalMs =
    startedAt !== null && completedAt !== null
      ? Date.parse(completedAt) - Date.parse(startedAt)
      : 0;

  const stepDetail = runEvents.some(
    (event) => event.kind !== null && STEP_EVENT_KINDS.has(event.kind)
  );

  return {
    workflow_id: workflowId,
    run_id: runId,
    correlation_id: correlationId,
    tenant,
    events: runEvents,
    spans: runSpans,
    summary: {
      status,
      started_at: startedAt,
      completed_at: completedAt,
      total_ms: totalMs,
      steps_ok: stepsOk,
      steps_failed: stepsFailed,
    },
    // Connector/agent scoped to this run's own events; channel deliberately
    // read from the full correlation fetch (see aggregate-run-cast.ts's
    // header) — the trigger/ingress event that carries the channel token is
    // not one of this run's own causation-scoped step events.
    cast: aggregateRunCast(runEvents, events),
    step_detail: stepDetail,
  };
}
