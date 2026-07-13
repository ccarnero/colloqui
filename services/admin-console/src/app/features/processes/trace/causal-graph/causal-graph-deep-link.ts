// causal-graph-deep-link.ts — adapts a causal-graph `ITrackedEvent` into
// `resolveEntityDeepLink`'s `{type, resource, payload}` input (T05 of
// `manual-loops/connector-trace-linking.md`). Pure function, no Angular/DOM.
//
// KNOWN GAP (grounding finding, reported rather than worked around):
// `tracking-ingester-service`'s chain endpoint deliberately excludes the raw
// envelope/payload from `ITrackedEvent` ("chain-list EXCLUDES payloads" —
// `build-events-query.ts` header) and only extracts click-through detail
// columns for TWO rule families (`extract-detail-columns.ts`): rule 11
// connector-invocation -> `connector_id`, rule 19 workflow-execution ->
// `workflow_id`/`run_id`. Rule 6 (`AGENT_EXECUTION_KINDS`, TAXONOMY.md §4)
// has NO extracted `agentId` column, so a causal-graph `ITrackedEvent` can
// never carry the agent id its "Open agent" link would need — this adapter
// can only ever resolve the CONNECTOR mapping. Extending the ingester's
// detail-column extraction to rule 6 is out of scope for this console-only
// task (T05 touches `services/admin-console` only per its Accept gate).
import type { ITrackedEvent } from "../../../../core/services/tracking-chain.service";
import {
  type IEntityDeepLink,
  resolveEntityDeepLink,
} from "../../domain/resolve-entity-deep-link";

/** Subject `<kind>` token connector-runtime's `endpoint_call_completed`
 * events classify to (TAXONOMY.md §4 rule 11) — the only `ITrackedEvent`
 * signal available to identify this family, since the raw envelope `type`
 * is not projected onto the row. */
const CONNECTOR_ENDPOINT_CALL_KIND = "endpoint_call_completed";

/** `event-publisher.ts` hardcodes `type: "connector.endpoint_call.completed.v1"`
 * alongside this exact subject kind on every publish (`emit()`'s
 * `baseOptions`) — a fixed 1:1 pairing this adapter reconstructs, not a
 * guess at a differently-shaped envelope type. */
const CONNECTOR_ENDPOINT_CALL_TYPE = "connector.endpoint_call.completed.v1";

export function resolveTrackedEventDeepLink(
  event: ITrackedEvent
): IEntityDeepLink | null {
  if (event.kind !== CONNECTOR_ENDPOINT_CALL_KIND || !event.connector_id) {
    return null;
  }
  return resolveEntityDeepLink({
    type: CONNECTOR_ENDPOINT_CALL_TYPE,
    resource: `adapter/${event.connector_id}`,
    payload: null,
  });
}
