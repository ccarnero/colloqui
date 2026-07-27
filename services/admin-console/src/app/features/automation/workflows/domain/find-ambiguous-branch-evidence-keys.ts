import { conditionEdgeLabel } from "./flow-deserializer";
import { getConditionalBranches } from "./get-conditional-branches";
import { resolveConditionalBranchTarget } from "./resolve-conditional-branch-target";
import {
  EWorkflowNodeType,
  type IWorkflowConnection,
  type IWorkflowNode,
} from "./workflow-node.types";

/**
 * Builds the join key used both here and by the config panel's per-branch
 * evidence lookup: the (targetActionName, branchLabel) pair that
 * /node-stats branch rows are keyed by.
 */
function evidenceKey(targetActionName: string, branchLabel: string): string {
  return `${targetActionName}::${branchLabel}`;
}

/**
 * Detects (targetActionName, branchLabel) pairs that are ambiguous because
 * MORE THAN ONE conditional node in the current flow routes a branch with
 * that same label to that same target action (dual-review objection 2, IF-
 * editor task attempt 2). /node-stats groups strictly by (action_name,
 * branch) with no conditional-node discriminator
 * (tracking-ingester-service build-node-stats-query.ts) — two different IF
 * nodes that both have, say, a "default" branch routing to the shared
 * action replyStandard produce ONE aggregate row that mixes both nodes'
 * runs. Presenting that merged number as either node's own evidence would
 * be a fabricated (falsely-attributed) fact.
 *
 * Scans every CONDITIONAL node's real branches (+ default, when present),
 * resolves each one's route target from the SAME flow state the canvas
 * edges render from, and returns the set of keys claimed by more than one
 * conditional node. The config panel hides evidence for any branch whose
 * key is in this set, on EVERY node that shares it.
 */
export function findAmbiguousBranchEvidenceKeys(
  nodes: readonly IWorkflowNode[],
  connections: readonly IWorkflowConnection[]
): ReadonlySet<string> {
  const nodesByKey: Record<string, IWorkflowNode> = {};
  for (const n of nodes) {
    nodesByKey[n.key] = n;
  }

  const ownersByKey = new Map<string, Set<string>>();
  const claim = (key: string, ownerNodeKey: string): void => {
    const owners = ownersByKey.get(key) ?? new Set<string>();
    owners.add(ownerNodeKey);
    ownersByKey.set(key, owners);
  };

  for (const node of nodes) {
    if (node.type !== EWorkflowNodeType.CONDITIONAL) {
      continue;
    }

    for (const branch of getConditionalBranches(node)) {
      if (!branch.condition.variable || !branch.condition.comparator) {
        continue;
      }
      const exprLabel = conditionEdgeLabel(
        branch.condition as unknown as Record<string, unknown>
      );
      const target = resolveConditionalBranchTarget(
        node.key,
        exprLabel,
        connections,
        nodesByKey
      );
      if (target) {
        claim(evidenceKey(target.node.name, branch.label), node.key);
      }
    }

    if (node.configuration["default"]) {
      const target = resolveConditionalBranchTarget(
        node.key,
        "default",
        connections,
        nodesByKey
      );
      if (target) {
        claim(evidenceKey(target.node.name, "default"), node.key);
      }
    }
  }

  const ambiguous = new Set<string>();
  for (const [key, owners] of ownersByKey) {
    if (owners.size > 1) {
      ambiguous.add(key);
    }
  }
  return ambiguous;
}
