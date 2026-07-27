import type {
  IConditionalBranchConfig,
  IWorkflowNode,
} from "./workflow-node.types";

/**
 * Reads a conditional node's branches array off its configuration, with
 * the same defensive shape-check used throughout the builder (a node
 * loaded from a malformed/legacy payload may have no branches array at
 * all). Extracted as a shared pure function so both the config panel and
 * the branch-evidence ambiguity resolver read branches the exact same way
 * (IF-editor task attempt 2).
 */
export function getConditionalBranches(
  node: IWorkflowNode
): IConditionalBranchConfig[] {
  const branches = node.configuration["branches"];
  return Array.isArray(branches)
    ? (branches as IConditionalBranchConfig[])
    : [];
}
