// scope-run-events.ts — scopes a correlation-wide event fetch down to the
// events that actually belong to ONE run (T01 cross-run-leakage fix,
// manual-loops/run-view.md attempt 2). Pure function, no I/O.
//
// THE DEFECT (live-verified): when a single trigger fires MULTIPLE workflow
// runs (shared triggers — e2e-http-log + e2e-http-agent share every message),
// every run's `execution_started` shares the SAME `correlation_id`. Fetching
// "every event of the correlation" therefore returns every SIBLING run's
// step events too — a run with 1 `agentCall` action reported `steps_ok: 2`
// because it also counted the sibling's `jsFunction` action_completed.
//
// THE FIX — identify the run's OWN events within the shared correlation:
//   - `execution_started`: the root row itself, already resolved by
//     `(workflow_id, run_id)` columns (build-run-root-query.ts) — re-found
//     here by the SAME predicate over the re-fetched correlation events, so
//     this file never trusts a second, independent identity.
//   - Step events (`action_started`/`action_completed`/`condition_evaluated`):
//     verified against `workflows.ts` (`runWorkflow` + `emitConditionEvaluatedTelemetry`)
//     — EVERY step event of a run cites the run's `execution_started` event
//     id as its `causation_id` (`stepEvents.actionCausal.causation_id =
//     executionStartedEventId`, a SIBLING hop off `execution_started`, never
//     chained action-to-action). `causation_id === startedEvent.event_id` is
//     therefore an exact, run-scoped filter — a sibling run's steps cite
//     THEIR OWN `execution_started` id, never this one's.
//   - `execution_completed`: verified against
//     `execution-completed-publisher.activity.ts` — its payload carries ONLY
//     `executionId` (no `workflowId`/`runId` at all), so it cannot be matched
//     by the `workflow_id`/`run_id` columns the way `execution_started` is.
//     BUT `extractDetailColumns` (rule 19) sets `workflow_id` from
//     `record.workflowId ?? record.executionId` — since `execution_completed`
//     has no `workflowId`, its `workflow_id` COLUMN holds `executionId`
//     verbatim (live evidence: a nanoid like "-pFT66...", not a real Temporal
//     workflow id). Matched here against the run's OWN executionId, read off
//     `execution_started`'s `payload_execution_id` column (same jsonb-path
//     extraction discipline as `payload_connector_id`/`payload_agent_id`,
//     see build-run-events-query.ts).
//
// EXCLUDED by design: context/trigger events (webhook_received / ingress —
// TAXONOMY.md §4 rules 2-5) are NOT part of the run's own events — they are
// the shared upstream cause of every sibling run, not a step of THIS run.
// `to-run-response.ts` still reads the channel cast from the FULL correlation
// fetch (a separate, explicit argument), never from this function's output —
// see that file's header for the documented split.

import type { RunEventRow } from "./build-run-events-query.js";

const STEP_EVENT_KINDS = new Set([
  "action_started",
  "action_completed",
  "condition_evaluated",
]);

export interface ScopedRunEvents {
  /** This run's own events only: `execution_started`, its causation-matched
   * step events, and its executionId-matched `execution_completed` — sorted
   * by `occurred_at`. Empty when the run's `execution_started` row could not
   * be re-identified in `events` (defensive; should be unreachable since
   * `handleRunRequest` already resolved it via `build-run-root-query.ts`). */
  readonly runEvents: readonly RunEventRow[];
  /** The run's own `execution_started` row, or `null` if not found. */
  readonly startedEvent: RunEventRow | null;
  /** The run's `executionId` (from `startedEvent.payload_execution_id`),
   * or `null` if `startedEvent` was not found. */
  readonly executionId: string | null;
}

/**
 * Scopes `events` (a correlation-wide fetch, possibly containing sibling
 * runs' events) down to `(workflowId, runId)`'s own run.
 */
export function scopeRunEvents(
  events: readonly RunEventRow[],
  workflowId: string,
  runId: string
): ScopedRunEvents {
  const startedEvent =
    events.find(
      (event) =>
        event.kind === "execution_started" &&
        event.workflow_id === workflowId &&
        event.run_id === runId
    ) ?? null;

  if (startedEvent === null) {
    return { runEvents: [], startedEvent: null, executionId: null };
  }

  const executionId = startedEvent.payload_execution_id;
  const startedEventId = startedEvent.event_id;

  // Step events: causation_id is the run's OWN execution_started event id —
  // never satisfied by a sibling run's step events (see header).
  const steps = events.filter(
    (event) =>
      event.kind !== null &&
      STEP_EVENT_KINDS.has(event.kind) &&
      event.causation_id === startedEventId
  );

  // execution_completed: matched by workflow_id column (== its own
  // executionId, per extractDetailColumns's fallback) against the run's
  // own executionId — never satisfied by a sibling run's completion.
  const completedEvent =
    executionId !== null
      ? events.find(
          (event) =>
            event.kind === "execution_completed" &&
            event.workflow_id === executionId
        )
      : undefined;

  const runEvents = [
    startedEvent,
    ...steps,
    ...(completedEvent ? [completedEvent] : []),
  ].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  return { runEvents, startedEvent, executionId };
}
