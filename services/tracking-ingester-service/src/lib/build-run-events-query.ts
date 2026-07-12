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
  /** `data.payload.actionIndex` — 0-based position of the action within its
   * own action list (top-level, a `branch` sub-list, or a `conditional`
   * branch/default list; NOT globally unique across nesting). Set on
   * `action_started`/`action_completed`/`condition_evaluated` (T03 of
   * `manual-loops/run-view.md`, extending the projection T01 flagged as the
   * anticipated follow-up). `merge-run.ts` uses it to match executed events
   * back to definition actions. Cast to `int` at the DB layer the same way
   * `duration_ms` is cast to `Number` at the normalize layer — Postgres'
   * `->>'actionIndex'` returns text, so this column arrives as a numeric
   * STRING from the driver and `normalize-run-event-row.ts` converts it. */
  payload_action_index: number | null;
  /** `data.payload.actionType` — the `WorkflowAction.activity` discriminant
   * (`endpointCall|mcpCall|jsFunction|serviceBusCall|serviceCall|
   * channelSend|agentCall|branch|conditional`). Set on
   * `action_started`/`action_completed`. Null otherwise. */
  payload_action_type: string | null;
  /** `data.payload.actionName` — `WorkflowAction.name`. Set on
   * `action_started`/`action_completed`. Null otherwise. */
  payload_action_name: string | null;
  /** `data.payload.branch` — label of the enclosing fork/conditional branch
   * path (e.g. `"pathA/approved"`), when the action is nested. Set on
   * `action_started`/`action_completed` for nested actions only; null for
   * top-level actions and every other event kind. */
  payload_branch: string | null;
  /** `data.payload.expression` — `{{path.to.value}}`-shaped reference to the
   * tested variable. Set on `condition_evaluated` only. */
  payload_expression: string | null;
  /** `data.payload.evaluatedValue` — scalar/short evaluated value (never the
   * full variable scope). Set on `condition_evaluated` only. */
  payload_evaluated_value: string | null;
  /** `data.payload.branchTaken` — matched case label, `"default"` when the
   * default branch ran, `null` for if-without-else evaluating false (both
   * "not set on this event kind" and "explicitly null in the payload"
   * collapse to SQL NULL here — `merge-run.ts` does not need to
   * distinguish them, since it only reads this column on `condition_evaluated`
   * rows in the first place). Set on `condition_evaluated` only. */
  payload_branch_taken: string | null;
  /** `data.payload.cases` — declared case labels, in definition order, as a
   * raw JSON array (`jsonb`, not text — same "extract as JSON, not text"
   * choice `resolve-payload.ts` uses for structured payload fields, so
   * `normalize-run-event-row.ts` doesn't need to `JSON.parse` a
   * double-encoded string). Set on `condition_evaluated` only; `null`
   * (never `[]`) on every other event kind. */
  payload_cases: string[] | null;
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
  // T03 of manual-loops/run-view.md — the anticipated follow-up flagged in
  // this file's header comment: widening the projection with the fields
  // `merge-run.ts`/`layout-run.ts` need to build the executed step tree.
  // `->>'actionIndex'` extracts as TEXT (same as `duration_ms` from
  // `tracking.tracked_event_spans`, which also arrives as a driver string) —
  // `normalize-run-event-row.ts` converts it to `number | null`, never a SQL
  // `::int` cast, so a malformed/missing value degrades to `NaN`-checked
  // `null` in JS instead of failing the whole query.
  "envelope->'data'->'payload'->>'actionIndex' AS payload_action_index",
  "envelope->'data'->'payload'->>'actionType' AS payload_action_type",
  "envelope->'data'->'payload'->>'actionName' AS payload_action_name",
  "envelope->'data'->'payload'->>'branch' AS payload_branch",
  "envelope->'data'->'payload'->>'expression' AS payload_expression",
  "envelope->'data'->'payload'->>'evaluatedValue' AS payload_evaluated_value",
  "envelope->'data'->'payload'->>'branchTaken' AS payload_branch_taken",
  // `->'cases'` (NOT `->>`) keeps it jsonb so the `postgres` driver
  // auto-parses it into a real JS array — same choice `build-payload-query.ts`
  // makes for the whole payload object, just narrowed to one field here.
  "envelope->'data'->'payload'->'cases' AS payload_cases",
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
