// scope-run-spans.ts — scopes a correlation-wide spans fetch down to the
// spans that belong to ONE run (T01 cross-run-leakage fix,
// manual-loops/run-view.md attempt 2). Pure function, no I/O.
//
// Investigated against src/sql/span-pairs.sql (the `tracking.tracked_event_spans`
// view this reads from):
//   - The workflow-execution span (the `execution_started`/`execution_completed`
//     pair) gets its `entity_id` from `COALESCE(payload.run_id, payload.workflow_id,
//     payload.execution_id, payload.executionId, payload.call_id)`. Both
//     `execution_started` and `execution_completed` payloads carry
//     `executionId` (camelCase) — the ONLY one of those five keys either
//     payload actually has (the view's other keys are snake_case and never
//     set by this producer) — so `entity_id === executionId` identifies
//     exactly this run's workflow-execution span, never a sibling's.
//   - Step-event spans (`action_started`/`action_completed` pairs and
//     `condition_evaluated` point spans): their payloads carry NO
//     `run_id`/`workflow_id`/`execution_id`/`executionId`/`call_id` key at
//     all (only `executionId` at the TOP level of the payload for
//     correlation purposes — wait, they DO carry `executionId` too, but the
//     view's COALESCE only reads snake_case `run_id`/`workflow_id`/
//     `execution_id` PLUS camelCase `executionId` — action payloads have
//     `executionId` set, so in principle entity_id COULD resolve for them.
//     However the documented, verified filter that is guaranteed correct
//     for step spans is `causation_id`, mirroring `scope-run-events.ts`:
//     the view's `paired`/`unpaired` CTEs both carry `causation_id` straight
//     through from the underlying row (`base.causation_id`), and per
//     `workflows.ts` EVERY step event's `causation_id` is the run's own
//     `execution_started` event id. `causation_id === startedEventId` is
//     therefore used as the primary step-span filter (exact, not
//     coincidental), with `entity_id === executionId` covering the
//     workflow-execution span itself (whose OWN causation_id is the
//     upstream trigger's, not itself).
//   - `event_id === startedEventId` is included defensively so the run's own
//     `execution_started` row is never dropped even if it fails to pair
//     (e.g. `execution_completed` missing for a still-running execution) —
//     it would otherwise fall through to `unpaired` with `entity_id` set
//     (since its own payload has `executionId`), which the `entity_id`
//     branch already covers, but this keeps the filter honest about WHY.

import type { ChainSpanRow } from "./build-spans-query.js";

/**
 * Scopes `spans` (a correlation-wide fetch, possibly containing sibling
 * runs' spans) down to the spans belonging to one run, identified by its
 * `execution_started` event id (`startedEventId`) and its `executionId`.
 * Returns an empty array when neither identifier is available (the run's
 * `execution_started` row could not be resolved — see
 * `scope-run-events.ts`).
 */
export function scopeRunSpans(
  spans: readonly ChainSpanRow[],
  startedEventId: string | null,
  executionId: string | null
): readonly ChainSpanRow[] {
  if (startedEventId === null && executionId === null) {
    return [];
  }

  return spans.filter(
    (span) =>
      (executionId !== null && span.entity_id === executionId) ||
      (startedEventId !== null && span.causation_id === startedEventId) ||
      (startedEventId !== null && span.event_id === startedEventId)
  );
}
