import type {
  ITraceNode,
  ITraceNodeInput,
  ITraceResult,
  TraceVerdict,
} from "./message-trace.model";
import { subscribersFor } from "./transport-topology";

/**
 * Assembles a causal-chain tree from persisted audit rows (channel + platform
 * events sharing one correlation_id). Pure — no Angular, no I/O.
 *
 *  - Orders nodes by `createdAt` ascending (the timeline order).
 *  - Links children by `causationId -> parent.id`.
 *  - Roots are nodes with `causationId == null` or whose parent isn't present
 *    (pre-cutover / cross-store gaps) — the earliest root becomes `root`.
 *  - Attaches each node's known subscribers from the static topology.
 *  - Derives the round-trip verdict.
 */
export function assembleTrace(
  correlationId: string,
  inputs: readonly ITraceNodeInput[],
): ITraceResult {
  if (inputs.length === 0) {
    return {
      correlationId,
      root: null,
      nodes: [],
      nodeCount: 0,
      verdict: "empty",
      deliveryCount: 0,
    };
  }

  const ordered = [...inputs].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );

  const childIds = new Map<string, string[]>();
  const present = new Set(ordered.map((n) => n.id));
  for (const n of ordered) {
    if (n.causationId && present.has(n.causationId)) {
      const list = childIds.get(n.causationId);
      if (list) list.push(n.id);
      else childIds.set(n.causationId, [n.id]);
    }
  }

  const byId = new Map(ordered.map((n) => [n.id, n]));
  const built = new Map<string, ITraceNode>();

  const build = (id: string): ITraceNode => {
    const cached = built.get(id);
    if (cached) return cached;
    const input = byId.get(id) as ITraceNodeInput;
    const node: ITraceNode = {
      ...input,
      subscribers: subscribersFor(input.subject),
      children: (childIds.get(id) ?? []).map(build),
    };
    built.set(id, node);
    return node;
  };

  const flat = ordered.map((n) => build(n.id));
  const rootInput = ordered.find(
    (n) => !n.causationId || !present.has(n.causationId),
  );
  const root = rootInput ? (built.get(rootInput.id) ?? null) : null;

  const deliveryCount = flat.reduce(
    (sum, n) => sum + n.subscribers.length,
    0,
  );

  return {
    correlationId,
    root,
    nodes: flat,
    nodeCount: flat.length,
    verdict: deriveVerdict(flat),
    deliveryCount,
  };
}

/**
 * A persisted `sent` event is the egress delivery confirmation (channel-service
 * shadow-publishes `sent.v1` only after the provider accepts the message), so
 * its presence is conclusive — no live consumer health needed for the happy path.
 *
 * sent present            -> "replied"   (delivered, confirmed by audit)
 * send present, failed     -> "failed"    (Slice 2 health)
 * send present, no sent     -> "published-unconfirmed"  (in-flight or failed)
 * received only            -> "received"
 */
function deriveVerdict(nodes: readonly ITraceNode[]): TraceVerdict {
  if (nodes.some((n) => n.kind === "sent")) return "replied";
  const send = nodes.find((n) => n.kind === "send");
  if (!send) return "received";
  if (send.delivery === "delivered") return "replied";
  if (send.delivery === "failed") return "failed";
  return "published-unconfirmed";
}
