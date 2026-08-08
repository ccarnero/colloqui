// build-events-query.ts — parametrized SQL for `GET /events?type=<t>&resource=<r>
// &from=<iso>&limit=<n>&endpointId=<id>&toolName=<name>` (T03 of
// manual-loops/connector-trace-linking.md; `endpointId` added by T01 and
// `toolName` by T06 of
// manual-loops/connectors/endpoint-scoped-recent-calls.md): the
// generic events-by-type/resource list the connector "Recent calls" feature (and
// any future entity-detail "recent activity" panel) reads from
// `tracking.tracked_events` directly instead of audit-service's 60-minute window.
//
// Column set mirrors `ChainEventRow`/`RunEventRow` (never `SELECT *`, exclude the
// raw envelope jsonb), PLUS five payload-scalar columns extracted at query time
// the same way `build-run-events-query.ts` extracts step-event fields.
//
// `type`/`resource` mapping decision (verified against
// `services/connector-runtime/src/activities/_shared/event-publisher.ts`):
//   - `type` filters on `envelope->>'type'` (the CloudEvents-style field, e.g.
//     `"connector.endpoint_call.completed.v1"`), NOT the `domain`/`kind`/`version`
//     columns. Those columns are derived from the NATS *subject* and project as
//     `"platform.endpoint_call_completed.v1"` for this same event family — a
//     DIFFERENT string (T02 finding, manual-loops/connector-trace-linking.md).
//     The console's existing `connector-call.service.ts` already sends
//     `type=connector.endpoint_call.completed.v1` (matching `envelope.type`) to
//     audit-service; migrating it to this endpoint (T04) must accept the SAME
//     value it already sends, so `type` is scoped to `envelope->>'type'`.
//   - `resource` filters on `envelope->>'resource'` (e.g. `"adapter/<adapterId>"`)
//     for the identical reason: `event-publisher.ts` sets
//     `resource: \`adapter/${evt.adapterId}\`` on the envelope, and T05's deep-link
//     mapping table (manual-loops/connector-trace-linking.md) matches routes on
//     that exact `resource` shape. The `connector_id` column stores the bare id
//     (`adapterId ?? endpointId`, see `extract-detail-columns.ts`) for a DIFFERENT
//     purpose (T6 connector-detail dashboard filter) and is deliberately NOT reused
//     here — `resource` is optional and this endpoint must generalize to
//     non-connector families (mcp/agent/hosted-service, explicitly flagged as a
//     future consumer in the SPEC's "Out of scope" section) whose `resource` shape
//     is not `adapter/<id>`, so matching the envelope field verbatim is the only
//     choice that stays correct for all of them. This verbatim match already
//     covers the T01/T02/T03 additions (`service/<name>`, `raw/<host>`,
//     `mcp/<mcpServerId>` — `manual-loops/connectors/connection-call-inspector.md`
//     T05, decision 7) with NO code change, since those are ordinary
//     `envelope.resource` values set at publish time, same as `adapter/<id>`.
//   - EXCEPTION — `resource=agent/<agentId>` (T05, needed by T10's "Recent
//     executions" panel): agent-execution events (TAXONOMY.md §4 rule 6, a
//     DUAL-token family since the E3 migration —
//     `evt.*.ai-agent-gateway.automation.platform.internal.execution_requested.v1`
//     from the gateway plus the frozen pre-2026-08-07 history of the other
//     three kinds, and
//     `evt.*.agent-ai-service.automation.platform.internal.execution_*.v1`
//     for started/completed/failed since then; see
//     `PENDIENTES/04-e3-subject.spec.md`) do NOT carry an
//     `agent/<agentId>`-shaped `envelope.resource`. The alias below is
//     TOKEN-AGNOSTIC and unaffected by the move: it never matches on the
//     subject, only on the payload's `agentId` field, which both tokens
//     carry identically. The emitter (out of scope for this ingester-only task) sets
//     `resource: "execution/<executionId>"` (verified against
//     `golden/raw/INGRESS-ACME-seq1245.json` / `-seq1251.json`), addressable
//     by execution, not by agent. Rather than block T10 on an emitter change
//     outside this task's touched-service list, `agent/<agentId>` is handled
//     as a query-level alias: it filters on the `agentId` field ALREADY
//     present in every `execution_started`/`execution_completed` payload
//     (`envelope.data.payload.agentId`; `execution_requested` nests it one
//     level deeper at `payload.input.agentId`, hence the `COALESCE`) instead
//     of `envelope->>'resource'`. No schema/column change (the SPEC's
//     "click-through columns gain nothing unless the query plan needs it"
//     guardrail) — a functional index covers the lookup instead
//     (`tracked-events.sql`, T05 addendum).
//
// Tenant scoping is a STRICT `tenant = $1` (no `OR tenant IS NULL`), same
// rationale as `build-run-root-query.ts`: `connector.endpoint_call.completed.v1`
// (and every other canonical `evt.*` family this endpoint targets) always carries
// a real tenant — there is no drift-row allowance to make here, unlike the
// chain/payload queries which intentionally include correlation-linked
// non-envelope rows.

import type { TrackedEventRow } from "./to-tracked-event-row.js";

export interface EventsQueryParams {
  readonly tenant: string;
  readonly type: string;
  /**
   * `envelope->>'resource'` filter, e.g. `"adapter/<id>"`, `"service/<name>"`,
   * `"raw/<host>"`, `"mcp/<mcpServerId>"`. Optional. The single exception is
   * `"agent/<agentId>"` (T05 addendum, see the header note above), which is
   * NOT matched against `envelope->>'resource'` — it filters on the
   * agent-execution payload's `agentId` field instead.
   */
  readonly resource: string | null;
  /** Inclusive lower bound on `occurred_at`, ISO-8601. Optional. */
  readonly from: string | null;
  /**
   * `envelope->'data'->'payload'->>'endpointId'` filter (T01 of
   * `manual-loops/connectors/endpoint-scoped-recent-calls.md`) — the id of
   * the single connector endpoint whose calls the caller wants, as published
   * by `services/connector-runtime/src/activities/_shared/event-publisher.ts:81`.
   * Optional, and COMPOSES with `type`/`resource`/`from` (it never replaces
   * any of them): `resource=adapter/<id>` narrows to one connector,
   * `endpointId=<id>` narrows further to one endpoint of it. Matched
   * verbatim with NO `COALESCE` fallback — an event family that does not
   * carry the payload field simply never matches, which is the intended
   * behavior (no schema/column change, same guardrail as the `agentId`
   * addendum above).
   */
  readonly endpointId: string | null;
  /**
   * `envelope->'data'->'payload'->>'toolName'` filter (T06 of
   * `manual-loops/connectors/endpoint-scoped-recent-calls.md`) — the name of
   * the single MCP tool whose calls the caller wants, as carried by
   * `connector.mcp_call.completed.v1` payloads (the same field the
   * `payload_tool_name` projection column already reads; NO new projection
   * column is needed here). Optional, and COMPOSES with
   * `type`/`resource`/`from`/`endpointId` (it never replaces any of them):
   * `resource=mcp/<mcpServerId>` narrows to one MCP server, `toolName=<name>`
   * narrows further to one tool of it. Matched verbatim as an opaque name
   * with NO `COALESCE` fallback — an event family that does not carry the
   * payload field simply never matches, which is the intended behavior (same
   * guardrail as `endpointId` above).
   */
  readonly toolName: string | null;
  /** Already clamped to `[1, MAX_LIST_LIMIT]` by the caller (`clampListLimit`). */
  readonly limit: number;
}

export interface EventsQuery {
  readonly text: string;
  readonly params: readonly (string | number)[];
}

/** Row shape returned by the query built here — a projection of
 * `TrackedEventRow` (envelope excluded) plus the payload scalars each of the
 * supported event kinds needs. T06 of
 * `manual-loops/connectors/connection-call-inspector.md`: the projection is
 * STATIC (always the full superset of known scalar columns, same as the
 * original five HTTP-only columns below) rather than branching SQL on
 * `params.type` — a single `/events` call is already scoped to exactly one
 * `envelope->>'type'` value via the WHERE clause, so a row for e.g.
 * `connector.mcp_call.completed.v1` simply yields `null` for the
 * HTTP/LLM/agent-only columns (their JSON paths don't exist in that
 * payload) — same "empty jsonb path -> null" behavior Postgres already gives
 * the five original columns for non-HTTP kinds. This keeps the query text
 * fully static (no per-type conditional SQL to test) while still excluding
 * request/response bodies, `arguments`/`result`, and `prompt`/`completion`
 * from every list projection. */
export type EventRow = Pick<
  TrackedEventRow,
  | "event_id"
  | "subject"
  | "tenant"
  | "producer"
  | "domain"
  | "kind"
  | "version"
  | "correlation_id"
  | "causation_id"
  | "causation_depth"
  | "occurred_at"
  | "tech"
  | "business_fn"
  | "rule"
  | "consumed_by"
  | "is_claim_check"
  | "compliance"
  | "workflow_id"
  | "run_id"
  | "connector_id"
  | "cache_status"
> & {
  has_envelope: boolean;
  /** `data.payload.method` — HTTP method of the connector call. */
  payload_method: string | null;
  /** `data.payload.resolvedUrl` — the resolved outbound URL (already
   * truncated at publish time, see `event-publisher.ts`'s `MAX_URL_LEN`). */
  payload_resolved_url: string | null;
  /** `data.payload.status` — HTTP response status code. Named
   * `payload_http_status`, NOT `payload_status`, to avoid colliding with the
   * unrelated `TrackedEventRow.payload_status` lifecycle column (`"inline" |
   * "resolved" | ...`) — the two have nothing to do with each other. */
  payload_http_status: number | null;
  /** `data.payload.durationMs` — call duration in milliseconds. Shared
   * across `connector.endpoint_call.completed.v1`,
   * `connector.mcp_call.completed.v1`, `ai.llm_call.completed.v1`, and
   * (when present) `io.yoizen.platform.runtime.execution_completed.v1` — all
   * four kinds carry this field at the same payload top level. */
  payload_duration_ms: number | null;
  /** `data.payload.cacheResult` — `"hit" | "miss" | "bypass" | null`. HTTP
   * connector calls only. */
  payload_cache_result: string | null;
  /** `data.payload.endpointId` — the connector endpoint the call targeted,
   * emitted by
   * `services/connector-runtime/src/activities/_shared/event-publisher.ts:81`
   * (T01 of `manual-loops/connectors/endpoint-scoped-recent-calls.md`). A
   * SCALAR only: the raw `envelope` jsonb stays excluded from this (and
   * every other) list projection. `null` for event families that don't carry
   * the field. */
  payload_endpoint_id: string | null;
  /** `data.payload.toolName` — `connector.mcp_call.completed.v1` only. */
  payload_tool_name: string | null;
  /** `data.payload.success` — `connector.mcp_call.completed.v1` only. */
  payload_success: boolean | null;
  /** `data.payload.error` — error MESSAGE only (never a full error object),
   * `connector.mcp_call.completed.v1` only. */
  payload_error: string | null;
  /** `data.payload.model` — `ai.llm_call.completed.v1` and
   * `io.yoizen.platform.runtime.execution_completed.v1`. */
  payload_model: string | null;
  /** `data.payload.provider` — `ai.llm_call.completed.v1` only. */
  payload_provider: string | null;
  /** `data.payload.inputTokens` — `ai.llm_call.completed.v1` only. */
  payload_input_tokens: number | null;
  /** `data.payload.outputTokens` — `ai.llm_call.completed.v1` only. */
  payload_output_tokens: number | null;
  /** `data.payload.costUsd` — `ai.llm_call.completed.v1` and
   * `io.yoizen.platform.runtime.execution_completed.v1`. */
  payload_cost_usd: number | null;
  /** `data.payload.state` —
   * `io.yoizen.platform.runtime.execution_completed.v1` only (e.g.
   * `"completed" | "failed"`). */
  payload_state: string | null;
};

const EVENTS_COLUMNS = [
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
  // HTTP connector calls (`connector.endpoint_call.completed.v1`).
  "envelope->'data'->'payload'->>'method' AS payload_method",
  "envelope->'data'->'payload'->>'resolvedUrl' AS payload_resolved_url",
  "envelope->'data'->'payload'->>'status' AS payload_http_status",
  "envelope->'data'->'payload'->>'durationMs' AS payload_duration_ms",
  "envelope->'data'->'payload'->>'cacheResult' AS payload_cache_result",
  // Connector endpoint identity (T01 of
  // `manual-loops/connectors/endpoint-scoped-recent-calls.md`). Emitted by
  // `services/connector-runtime/src/activities/_shared/event-publisher.ts:81`
  // (`endpointId: evt.endpointId` on the endpoint_call payload). Projected
  // as a scalar so the console can label/group calls per endpoint without
  // fetching the envelope.
  "envelope->'data'->'payload'->>'endpointId' AS payload_endpoint_id",
  // MCP tool calls (`connector.mcp_call.completed.v1`, T06). Bodies
  // (`arguments`/`result`) are deliberately NEVER projected here.
  "envelope->'data'->'payload'->>'toolName' AS payload_tool_name",
  "envelope->'data'->'payload'->>'success' AS payload_success",
  "envelope->'data'->'payload'->>'error' AS payload_error",
  // Standalone LLM calls (`ai.llm_call.completed.v1`, T06) and agent-execution
  // lifecycle (`io.yoizen.platform.runtime.execution_completed.v1`, T06)
  // share `model`/`costUsd`. `prompt`/`completion`/`response` bodies are
  // deliberately NEVER projected here.
  "envelope->'data'->'payload'->>'model' AS payload_model",
  "envelope->'data'->'payload'->>'provider' AS payload_provider",
  "envelope->'data'->'payload'->>'inputTokens' AS payload_input_tokens",
  "envelope->'data'->'payload'->>'outputTokens' AS payload_output_tokens",
  "envelope->'data'->'payload'->>'costUsd' AS payload_cost_usd",
  // Agent-execution lifecycle only.
  "envelope->'data'->'payload'->>'state' AS payload_state",
] as const;

/**
 * `resource=agent/<agentId>` query-value prefix (T05 addendum, see the header
 * note above) — the ONE `resource` shape that does NOT filter on
 * `envelope->>'resource'` verbatim.
 */
const AGENT_RESOURCE_PREFIX = "agent/";

/**
 * Builds the parametrized SQL that fetches `tracking.tracked_events` rows
 * scoped to `tenant`, filtered by `envelope->>'type'` (required), optionally
 * `envelope->>'resource'`, a lower `occurred_at` bound and the payload's
 * `endpointId`/`toolName` (each an independent AND — they compose), ordered
 * `occurred_at DESC` (most recent first — SPEC.md T03), capped at `limit`.
 * Never `SELECT *`; the raw `envelope` jsonb is excluded from the projection
 * (chain-list decision, manual-loops/trace-console.md T01, stands here too).
 */
export function buildEventsQuery(params: EventsQueryParams): EventsQuery {
  const conditions = ["tenant = $1", "envelope->>'type' = $2"];
  const values: (string | number)[] = [params.tenant, params.type];

  if (params.resource !== null) {
    if (params.resource.startsWith(AGENT_RESOURCE_PREFIX)) {
      // T05 addendum: filter on the agent-execution payload's `agentId`
      // field, not `envelope->>'resource'` (see the header note above for
      // why). `execution_started`/`execution_completed` carry `agentId` at
      // the payload top level; `execution_requested` nests it under
      // `input.agentId` — COALESCE covers both without a schema change.
      const agentId = params.resource.slice(AGENT_RESOURCE_PREFIX.length);
      values.push(agentId);
      conditions.push(
        `COALESCE(envelope->'data'->'payload'->>'agentId', envelope->'data'->'payload'->'input'->>'agentId') = $${values.length}`
      );
    } else {
      values.push(params.resource);
      conditions.push(`envelope->>'resource' = $${values.length}`);
    }
  }

  if (params.from !== null) {
    values.push(params.from);
    conditions.push(`occurred_at >= $${values.length}`);
  }

  // T01 of `manual-loops/connectors/endpoint-scoped-recent-calls.md`:
  // APPENDED to whatever `resource`/`from` already contributed — this is an
  // additional AND, never a replacement for the filters above.
  if (params.endpointId !== null) {
    values.push(params.endpointId);
    conditions.push(
      `envelope->'data'->'payload'->>'endpointId' = $${values.length}`
    );
  }

  // T06 of `manual-loops/connectors/endpoint-scoped-recent-calls.md`:
  // APPENDED to whatever `resource`/`from`/`endpointId` already contributed —
  // an additional AND, never a replacement. No new projection column: the
  // `payload_tool_name` scalar is already in `EVENTS_COLUMNS` above.
  if (params.toolName !== null) {
    values.push(params.toolName);
    conditions.push(
      `envelope->'data'->'payload'->>'toolName' = $${values.length}`
    );
  }

  values.push(params.limit);
  const limitPlaceholder = `$${values.length}`;

  const text = `SELECT ${EVENTS_COLUMNS.join(", ")}
FROM tracking.tracked_events
WHERE ${conditions.join("\n  AND ")}
ORDER BY occurred_at DESC
LIMIT ${limitPlaceholder}`;

  return { text, params: values };
}
