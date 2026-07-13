// resolve-step-deep-link.ts — adapts the run-view popup's matched step
// event (`action_started`/`action_completed`, from `resolve-step-events.ts`'s
// same `(branchPath, actionIndex)` match) into `resolveEntityDeepLink`'s
// `{type, resource, payload}` input (T05 of
// `manual-loops/connector-trace-linking.md`). Pure function, no Angular/DOM.
//
// Unlike `causal-graph-deep-link.ts` (which reads a raw tracked event and
// reconstructs the ORIGINAL producer's envelope type), the run-view popup's
// `IRunEvent` is workflow-service's own `action_started`/`action_completed`
// wrapper (TAXONOMY.md §4 rule 19) — it already carries the resolved
// `payload_connector_id`/`payload_agent_id` for whichever connector/agent
// that action invoked (`build-run-events-query.ts`; the SAME ids
// `run-view-popup-render.ts`'s `resolvePeekKind`/`connectorDeepLink`/
// `agentDeepLink` already deep-link to via the peek flow). This adapter
// reuses that identity, routed through the shared `resolveEntityDeepLink`
// function for a single "Open <entity>" decision point.
import type { IRunEvent } from "../../../../core/services/run-view.service";
import {
  type IEntityDeepLink,
  resolveEntityDeepLink,
} from "../../domain/resolve-entity-deep-link";
import { parseNodeId } from "./resolve-step-events";
import type { ILayoutNode } from "./run-view.model";

const CONNECTOR_ENDPOINT_CALL_TYPE = "connector.endpoint_call.completed.v1";
const AGENT_EXECUTION_COMPLETED_TYPE =
  "io.yoizen.platform.runtime.execution_completed.v1";

function toDeepLinkEvent(
  event: IRunEvent
): Parameters<typeof resolveEntityDeepLink>[0] {
  if (event.payload_connector_id) {
    return {
      type: CONNECTOR_ENDPOINT_CALL_TYPE,
      resource: `adapter/${event.payload_connector_id}`,
      payload: null,
    };
  }
  if (event.payload_agent_id) {
    return {
      type: AGENT_EXECUTION_COMPLETED_TYPE,
      resource: null,
      payload: { agentId: event.payload_agent_id },
    };
  }
  return { type: null, resource: null, payload: null };
}

/**
 * Resolves the clicked node's "Open <entity>" route from the run's OWN
 * events, preferring the `completed` event (post-execution, matches
 * `resolveStepEvents`' pairing) and falling back to `started` when the step
 * has not completed yet. Structural nodes (fork/conditional/join) and
 * not-executed steps carry neither `payload_connector_id` nor
 * `payload_agent_id` and resolve to `null`, same as `resolvePeekKind`.
 */
export function resolveStepDeepLink(
  node: ILayoutNode,
  events: readonly IRunEvent[]
): IEntityDeepLink | null {
  const { branchPath, actionIndex, isJoin } = parseNodeId(node.id);
  if (isJoin || actionIndex === null) {
    return null;
  }

  const matched = events.find(
    (event) =>
      (event.kind === "action_completed" || event.kind === "action_started") &&
      event.payload_action_index === actionIndex &&
      (event.payload_branch ?? null) === branchPath
  );
  if (!matched) {
    return null;
  }

  return resolveEntityDeepLink(toDeepLinkEvent(matched));
}
