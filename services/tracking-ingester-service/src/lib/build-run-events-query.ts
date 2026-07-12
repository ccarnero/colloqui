// build-run-events-query.ts — parametrized SQL for all events belonging to a
// run's correlation, scoped to a tenant (T01 of manual-loops/run-view.md).
// Same column set and tenant-scoping rule as build-chain-query.ts (never
// SELECT *, exclude the raw envelope jsonb), PLUS two extra columns read
// directly out of the jsonb envelope at query time — the same discipline
// build-payload-query.ts already uses for `envelope->'data'->'payload'`.
//
// FINDING (investigated against extract-detail-columns.ts and the actual
// publisher, services/workflow-service/.../execution-completed-publisher.
// activity.ts): step-level events (`action_started`, `action_completed`)
// DO carry `connectorId`/`agentId` and `status`, but ONLY inside
// `envelope.data.payload` — `extractDetailColumns` (rule 19) never promotes
// them to a queryable column (it only sets `workflow_id`/`run_id` for that
// rule; `connector_id` is populated exclusively by rule 11's
// connector-invocation family, a DIFFERENT event). `envelope.transport` also
// carries no `agent_id` for these events (`transport` is always
// `{method:"stream", protocol:"internal", depth}` — see the publisher).
// SPEC.md-shaped cast aggregation (connector/agent instances, run status,
// steps_ok/steps_failed) is therefore not reachable from projected columns
// alone. Rather than silently widening `extract-detail-columns.ts` (a
// mapper/DDL change out of this task's scope) or exposing the full raw
// envelope in the list response (breaking the "never SELECT the envelope
// into a list payload" contract), this query extracts the THREE specific
// JSON paths the run view needs at the DB layer, same pattern as
// build-payload-query.ts. This is reported as a finding for a follow-up
// mapper task, not a workaround: the emitter SHOULD arguably set
// `connector_id`/`agent_id` columns for rule 19 action events too, so a
// dashboard could filter/index on them without a jsonb path scan.

import type { TrackedEventRow } from "./to-tracked-event-row.js";

export interface RunEventsQuery {
  readonly text: string;
  readonly params: readonly [correlationId: string, tenant: string | null];
}

/** Row shape returned by the query built here — `TrackedEventRow` minus
 * `envelope`, plus `has_envelope` (same derivation as `ChainEventRow`) and
 * the three step-event payload fields the run view needs
 * (`payload_connector_id`/`payload_agent_id`/`payload_step_status`). */
export type RunEventRow = Omit<TrackedEventRow, "envelope"> & {
  has_envelope: boolean;
  /** `data.payload.connectorId` — set on `action_started`/`action_completed`
   * events for `endpointCall`/`serviceCall`/`mcpCall` actions. Null for every
   * other event (including when `connector_id` already carries the rule-11
   * connector-invocation value — the two are never both non-null for the
   * same row). */
  payload_connector_id: string | null;
  /** `data.payload.agentId` — set on `action_started`/`action_completed`
   * events for `agentCall` actions. Null for every other event. */
  payload_agent_id: string | null;
  /** `data.payload.status` — `"COMPLETED"|"FAILED"` on `execution_completed`,
   * `"ok"|"failed"|"skipped"` on `action_completed`. Null everywhere else
   * (including `action_started`, which has no status yet). */
  payload_step_status: string | null;
  /** `data.payload.executionId` — set on `execution_started`,
   * `action_started`/`action_completed`, `condition_evaluated` (all carry it,
   * see `workflows.ts`/`execution-completed-publisher.activity.ts`). Used by
   * `scope-run-events.ts` to identify the run's OWN `execution_started` row's
   * executionId and match the run's `execution_completed` row against it
   * (T01 cross-run-leakage fix, manual-loops/run-view.md) — `execution_completed`
   * carries no `workflowId`/`runId`, only `executionId`. Null on events that
   * don't carry it (e.g. connector-invocation rows from a different family). */
  payload_execution_id: string | null;
};

const RUN_EVENT_COLUMNS = [
  "event_id",
  "subject",
  "tenant",
  "producer",
  "domain",
  "kind",
  "version",
  "correlation_id",
  "causation_id",
  "causation_depth",
  "occurred_at",
  "tech",
  "business_fn",
  "rule",
  "consumed_by",
  "is_claim_check",
  "compliance",
  "workflow_id",
  "run_id",
  "connector_id",
  "cache_status",
  "(compliance <> 'none') AS has_envelope",
  "envelope->'data'->'payload'->>'connectorId' AS payload_connector_id",
  "envelope->'data'->'payload'->>'agentId' AS payload_agent_id",
  "envelope->'data'->'payload'->>'status' AS payload_step_status",
  "envelope->'data'->'payload'->>'executionId' AS payload_execution_id",
] as const;

/**
 * Builds the parametrized SQL that fetches every `tracking.tracked_events`
 * row belonging to `correlationId` (the run's resolved correlation root,
 * see `build-run-root-query.ts`), scoped to `tenant` — including rows with
 * a NULL tenant (drift/non-envelope rows), same scoping rule as
 * `buildChainQuery`.
 */
export function buildRunEventsQuery(
  correlationId: string,
  tenant: string | null
): RunEventsQuery {
  const text = `SELECT ${RUN_EVENT_COLUMNS.join(", ")}
FROM tracking.tracked_events
WHERE correlation_id = $1
  AND (tenant = $2 OR tenant IS NULL)
ORDER BY occurred_at`;

  return { text, params: [correlationId, tenant] };
}
