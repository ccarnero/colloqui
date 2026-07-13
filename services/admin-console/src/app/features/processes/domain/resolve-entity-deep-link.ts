// resolve-entity-deep-link.ts — pure event -> route mapping shared by the
// causal-graph detail card and the run-view popup (T05 of
// `manual-loops/connector-trace-linking.md`: "trace/run-view detail cards
// link OUT to the entity screens"). ONE function, in this shared
// `features/processes/domain/` layer, because both surfaces need the exact
// same routing decision — unlike `run-view-popup-render.ts`'s
// `formatPopupStatusLabel` (a feature-internal display helper deliberately
// duplicated to avoid cross-feature imports), this IS the cross-cutting
// concern the two features must agree on, so it lives one level up from
// both `trace/` and `run-view/`.
//
// Every branch below is traceable to a REAL emitter — verified against the
// producers themselves, not TAXONOMY.md prose alone (grounding step of this
// task):
//   - `connector.endpoint_call.completed.v1` + `resource: adapter/<id>`:
//     `services/connector-runtime/src/activities/_shared/event-publisher.ts`
//     (`emit()`, the `baseOptions` literal) — the ONLY event connector-runtime
//     actually publishes to NATS.
//   - `io.yoizen.platform.runtime.execution_started|completed|failed.v1` +
//     `payload.agentId`: `services/agent-ai-service/src/nats-handlers/
//     execution.handler.ts` (`publishStatus`, `type: \`io.yoizen.platform.
//     runtime.${kind}.v1\``, `data.agentId`).
//
// Deliberately NOT mapped (verified absent, not a guess):
//   - MCP calls: `services/connector-runtime/src/activities/mcp-call.
//     activity.ts` never builds an `EventEnvelope`/publishes to NATS — MCP
//     usage is reported via a direct HTTP POST to `agent-admin-service`
//     (`packages/shared/src/mcp-usage-client.ts` -> `POST admin/mcp-servers/
//     usage-events`), which persists to a usage table, not `tracking.
//     tracked_events`. No MCP tracked-event `type` string exists to match on.
//   - Hosted `serviceCall`: `service-call.activity.ts`'s own header comment
//     confirms it — "`serviceCall` emits no `endpoint_call_completed` event
//     to thread causal context into". No hosted-service tracked-event
//     exists either.
// Both gaps are reported in the task summary rather than worked around with
// an invented type string (human boundary: no mapping beyond the four
// entity types named in the SPEC, and no invented event types).

/** Minimal event shape this function needs — deliberately NOT the full
 * `EventEnvelope` (`@yoizen/shared`): callers adapt whatever event
 * representation they actually hold (a raw envelope, or a tracked-events row
 * that only carries a subset of envelope fields) into this shape. */
export interface IDeepLinkableEvent {
  readonly type: string | null;
  /** Envelope `resource` field, e.g. `"adapter/<id>"`. */
  readonly resource: string | null;
  readonly payload: Readonly<Record<string, unknown>> | null;
}

export interface IEntityDeepLink {
  readonly route: readonly string[];
  /** Button copy for the "Open <entity>" affordance. */
  readonly label: string;
}

const CONNECTOR_ENDPOINT_CALL_TYPE = "connector.endpoint_call.completed.v1";
const ADAPTER_RESOURCE_PREFIX = "adapter/";

/** `agent-ai-service`'s `execution.handler.ts`: `type` is built as
 * `` `io.yoizen.platform.runtime.${kind}.v1` `` for exactly these three
 * lifecycle kinds. */
const AGENT_EXECUTION_TYPES: ReadonlySet<string> = new Set([
  "io.yoizen.platform.runtime.execution_started.v1",
  "io.yoizen.platform.runtime.execution_completed.v1",
  "io.yoizen.platform.runtime.execution_failed.v1",
]);

/**
 * Maps a bus event's `{type, resource, payload}` to the entity-detail route
 * it deep-links to, per the SPEC.md T05 mapping table. Returns `null` for
 * anything unmapped (unknown type, or a mapped type missing the id it needs)
 * — the caller renders no "Open <entity>" button in that case.
 */
export function resolveEntityDeepLink(
  event: IDeepLinkableEvent
): IEntityDeepLink | null {
  // Rule: connector.endpoint_call.completed.v1 + resource adapter/<id> -> /connections/http/<id>
  if (
    event.type === CONNECTOR_ENDPOINT_CALL_TYPE &&
    event.resource?.startsWith(ADAPTER_RESOURCE_PREFIX)
  ) {
    const adapterId = event.resource.slice(ADAPTER_RESOURCE_PREFIX.length);
    return adapterId.length > 0
      ? { route: ["/connections/http", adapterId], label: "Open connector" }
      : null;
  }

  // Rule: agent execution_* events (payload.agentId) -> /ai/agents/<agentId>
  if (event.type !== null && AGENT_EXECUTION_TYPES.has(event.type)) {
    const agentId = event.payload?.["agentId"];
    return typeof agentId === "string" && agentId.length > 0
      ? { route: ["/ai/agents", agentId], label: "Open agent" }
      : null;
  }

  // MCP call events and hosted serviceCall events are intentionally NOT
  // mapped here — no real tracked-event `type` string exists for either
  // (see header). Everything else (unknown types) also falls through to null.
  return null;
}
