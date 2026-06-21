/** Hard cap to prevent memory exhaustion from pathological correlation_ids. */
export const MAX_CHAIN_NODES = 5000;

/**
 * Minimal event shape required by buildChainTree.
 * Both IAuditEvent and IStoredChannelEvent satisfy this interface structurally.
 */
export interface ChainInputEvent {
  id: string;
  type: string;
  subject: string;
  causation_id?: string | null;
  depth?: number;
  created_at: string;
}

export interface ChainNode {
  id: string;
  type: string;
  subject: string;
  causation_id: string | null | undefined;
  depth: number;
  created_at: string;
  children: ChainNode[];
}

export interface ChainTreeResult {
  correlation_id: string;
  root: ChainNode;
  node_count: number;
  max_depth: number;
  truncated: boolean;
  synthetic_root: boolean;
  orphans: ChainNode[];
  extra_roots: ChainNode[];
}

function toNode(event: ChainInputEvent): ChainNode {
  return {
    id: event.id,
    type: event.type,
    subject: event.subject,
    causation_id: event.causation_id,
    depth: event.depth ?? 0,
    created_at: event.created_at,
    children: [],
  };
}

/**
 * Assembles a causal-chain tree from a flat list of audit events that share
 * the same `correlation_id`. Pure function — no DB calls, backend-agnostic.
 *
 * Algorithm: O(n) single-pass map build + single-pass attachment. Iterative
 * (no recursion on input size). Bounded by MAX_CHAIN_NODES to protect memory.
 *
 * Returns `null` for empty input (caller maps to 404).
 */
export function buildChainTree(
  events: ChainInputEvent[],
  correlationId: string,
): ChainTreeResult | null {
  if (events.length === 0) {
    return null;
  }

  // Apply hard cap — truncate before processing
  const truncated = events.length > MAX_CHAIN_NODES;
  const bounded = truncated ? events.slice(0, MAX_CHAIN_NODES) : events;

  // Build id → node map
  const nodeMap = new Map<string, ChainNode>();
  for (const event of bounded) {
    nodeMap.set(event.id, toNode(event));
  }

  // Separate null-causation roots from non-roots
  const nullRoots: ChainNode[] = [];
  const nonRoots: ChainNode[] = [];

  for (const node of nodeMap.values()) {
    if (node.causation_id == null) {
      nullRoots.push(node);
    } else {
      nonRoots.push(node);
    }
  }

  // Sort null-causation roots by depth asc, created_at asc to pick the primary
  nullRoots.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });

  let primaryRoot: ChainNode;
  let syntheticRoot = false;
  const extraRoots: ChainNode[] = [];

  if (nullRoots.length > 0) {
    primaryRoot = nullRoots[0]!;
    extraRoots.push(...nullRoots.slice(1));
  } else {
    // No explicit root — synthesize from the lowest-depth node
    syntheticRoot = true;
    const allNodes = [...nodeMap.values()].sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
    });
    primaryRoot = allNodes[0]!;
  }

  // Attach non-root nodes to parents; collect orphans (parent not in set)
  const orphans: ChainNode[] = [];
  // Track which nodes have already been attached to prevent cycle issues
  const attached = new Set<string>([primaryRoot.id]);
  // extra_roots are also "attached" in the sense they won't be orphaned
  for (const er of extraRoots) {
    attached.add(er.id);
  }

  for (const node of nonRoots) {
    if (attached.has(node.id)) {
      // Skip — already placed (e.g. was a synthetic root candidate)
      continue;
    }
    const parentId = node.causation_id as string;
    const parent = nodeMap.get(parentId);
    if (parent) {
      parent.children.push(node);
      attached.add(node.id);
    } else {
      orphans.push(node);
    }
  }

  // Compute max_depth by walking the tree iteratively (BFS)
  let maxDepth = primaryRoot.depth;
  const queue: ChainNode[] = [primaryRoot, ...extraRoots];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth > maxDepth) {
      maxDepth = current.depth;
    }
    for (const child of current.children) {
      queue.push(child);
    }
  }

  return {
    correlation_id: correlationId,
    root: primaryRoot,
    node_count: bounded.length,
    max_depth: maxDepth,
    truncated,
    synthetic_root: syntheticRoot,
    orphans,
    extra_roots: extraRoots,
  };
}
