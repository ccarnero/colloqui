// match-endpoint-calls.ts — matches a run-view `endpointCall` step to the
// connector's own `endpoint_call_completed` event(s) in the SAME correlation
// (T09 of manual-loops/connector-trace-linking.md). Pure function, no
// Angular/DOM.
//
// WHY a separate data source (finding, verified against the ingester): the
// run endpoint's `events` array is SCOPED by `scope-run-events.ts` to the
// run's own `execution_*`/step events only — `endpoint_call_completed` rows
// (TAXONOMY.md §4 rule 11) are deliberately excluded, even though they now
// share the run's `correlation_id` (T01 causal fix). So the popup cannot
// read them off `run().events`; it fetches them via the EXISTING
// `ConnectorCallService.recentCalls` (`GET /tracking/events`), which already
// projects `event_id` + `resolvedUrl` + `status` + `correlation_id`
// server-side. This module then filters those rows down to the ones that
// belong to THIS step — console-only, no backend change (the run/chain data
// already suffices, per the T09 constraint).
//
// Match key: `connector_id` (the step's resolved adapter id) + occurred_at
// within the step's `action_started`/`action_completed` window, scoped to
// the run's correlation. The window disambiguates two `endpointCall` steps
// that hit the SAME adapter within one correlation (and sibling runs sharing
// a correlation). A branch fan-out that runs several endpoint calls under one
// step context yields MULTIPLE matches — all are returned (T09 req 3).

import type { IConnectorCall } from "../../../../core/services/connector-call.service";
import type { IStepEventPair } from "./resolve-step-events";
import type { ILayoutNode } from "./run-view.model";

/** One matched `endpoint_call_completed` event, trimmed to what the popup's
 * HTTP-call section needs: the `eventId` to fetch its payload on demand, plus
 * the server-projected scalars for the multi-match list label. */
export interface IEndpointCallMatch {
  readonly eventId: string;
  readonly method: string;
  readonly resolvedUrl: string;
  readonly status: number;
  readonly durationMs: number;
  readonly cacheResult: string | null;
  readonly occurredAt: string;
}

function withinWindow(
  ts: string,
  startedAt: string | null,
  completedAt: string | null
): boolean {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) {
    return false;
  }
  if (startedAt !== null) {
    const start = Date.parse(startedAt);
    if (!Number.isNaN(start) && t < start) {
      return false;
    }
  }
  if (completedAt !== null) {
    const end = Date.parse(completedAt);
    if (!Number.isNaN(end) && t > end) {
      return false;
    }
  }
  return true;
}

/**
 * Returns the `endpoint_call_completed` events that belong to `node` — an
 * `endpointCall` step — from `calls` (the run correlation's connector calls,
 * fetched via `ConnectorCallService.recentCalls`). Empty for any non-
 * `endpointCall` node, a node with no resolved adapter id, or when nothing
 * matches. Sorted by `occurredAt` so a multi-match list renders in call order.
 */
export function matchEndpointCalls(
  node: ILayoutNode,
  eventPair: IStepEventPair,
  calls: readonly IConnectorCall[],
  correlationId: string
): readonly IEndpointCallMatch[] {
  // Only `endpointCall` steps carry an HTTP endpoint_call event (agentCall/
  // channelSend/serviceBusCall/jsFunction do not; serviceCall/mcpCall emit no
  // endpoint_call_completed — see resolve-entity-deep-link.ts / T05 findings).
  if (node.actionType !== "endpointCall" || !node.instanceId) {
    return [];
  }
  const connectorId = node.instanceId;
  const startedAt = eventPair.started?.occurredAt ?? null;
  const completedAt = eventPair.completed?.occurredAt ?? null;

  return calls
    .filter(
      (call): call is IConnectorCall & { readonly eventId: string } =>
        typeof call.eventId === "string" &&
        call.eventId.length > 0 &&
        call.adapterId === connectorId &&
        call.correlationId === correlationId &&
        withinWindow(call.timestamp, startedAt, completedAt)
    )
    .map((call) => ({
      eventId: call.eventId,
      method: call.method,
      resolvedUrl: call.resolvedUrl,
      status: call.status,
      durationMs: call.durationMs,
      cacheResult: call.cacheResult,
      occurredAt: call.timestamp,
    }))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
