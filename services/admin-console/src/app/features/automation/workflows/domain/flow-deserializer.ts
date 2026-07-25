import {
  EWorkflowConnectionType,
  EWorkflowNodeType,
  type IWorkflowConnection,
  type IWorkflowNode,
} from "./workflow-node.types";
import { createNodeFromDefault } from "./workflow-node-defaults";

// Layout is vertical (top -> bottom): the trunk advances downward per step,
// and parallel branches fan out horizontally around the trunk's x. Node
// dimensions (see workflow-node-card.component.ts, SPEC T03 of
// console-redesign-builder-v2.md): width 236px, height ranges roughly 60px
// (icon/name/badge row only) to ~112px (with the config summary and stats
// rows). Y_STEP is tuned to that height range the same way
// the previous X_GAP was tuned to node width; X_BRANCH_GAP is tuned to node
// width the same way the previous Y_BRANCH_GAP was tuned to node height —
// the two constants are swapped, not re-derived, since the physical
// dimension each one targets (height for the trunk axis, width for the fan
// axis) simply changed axis along with the transposition.
const Y_START = 50;
const Y_STEP = 140;
const X_BASE = 100;
const X_BRANCH_GAP = 280;

interface DeserializedFlow {
  nodes: Record<string, IWorkflowNode>;
  connections: Record<string, IWorkflowConnection>;
}

/**
 * Reconstructs the visual flow graph from a saved workflow definition.
 * Handles linear actions and recursively expands branch/conditional paths
 * into child nodes with fan-out/fan-in connections.
 */
export function deserializeFlow(dto: {
  actions: unknown[];
  trigger: unknown | null;
}): DeserializedFlow {
  const nodes: Record<string, IWorkflowNode> = {};
  const connections: Record<string, IWorkflowConnection> = {};
  let connSeq = 0;

  const link = (src: string, tgt: string, label?: string): void => {
    const key = `conn-r-${connSeq++}`;
    connections[key] = {
      key,
      source: src,
      target: tgt,
      type: EWorkflowConnectionType.DEFAULT,
      ...(label ? { label } : {}),
    };
  };

  let tails: string[] = [];
  let row = 0;

  if (dto.trigger) {
    const tn = createNodeFromDefault(EWorkflowNodeType.CHANNEL, {
      x: X_BASE,
      y: Y_START,
    });
    const raw = dto.trigger as Record<string, unknown>;
    const cfg = raw["config"];
    if (cfg && typeof cfg === "object") {
      tn.configuration = {
        ...tn.configuration,
        ...(cfg as Record<string, unknown>),
      };
    }
    tn.configuration["direction"] = "inbound";
    tn.configuration["mode"] = (raw["mode"] as string) ?? "shared";
    nodes[tn.key] = tn;
    tails = [tn.key];
    row++;
  }

  if (Array.isArray(dto.actions)) {
    const result = deserializeChain(dto.actions, nodes, link, row, X_BASE);
    for (const tail of tails) {
      for (const head of result.heads) {
        link(tail, head);
      }
    }
    tails = result.tails.length > 0 ? result.tails : tails;
  }

  return { nodes, connections };
}

/** Extracts dynamic branch path keys from a branch action. */
function extractBranchPaths(
  action: Record<string, unknown>
): Array<[string, unknown[]]> {
  const skip = new Set(["activity", "name", "args"]);
  const paths: Array<[string, unknown[]]> = [];
  for (const [k, v] of Object.entries(action)) {
    if (!skip.has(k) && Array.isArray(v)) {
      paths.push([k, v]);
    }
  }
  return paths;
}

interface ChainResult {
  /** Keys of nodes with no incoming link from within this chain (only the first node, if any). */
  heads: string[];
  /** Keys that the caller should link the NEXT action to (the converge set). */
  tails: string[];
  /** Number of Y_STEP rows consumed by this chain, starting at the given startRow. */
  rows: number;
}

/**
 * Builds the edge-label text for a conditional branch, e.g.
 * `request.text contains "precio"` (design mockup 11-builder.png) — derived
 * verbatim from the branch's own real condition rule, never fabricated.
 * Returns undefined when the condition is missing/malformed so the edge
 * simply renders unlabeled instead of showing a broken string.
 */
function conditionEdgeLabel(
  condition: Record<string, unknown> | undefined
): string | undefined {
  const variable = condition?.["variable"];
  const comparator = condition?.["comparator"];
  const value = condition?.["value"];
  if (typeof variable !== "string" || typeof comparator !== "string") {
    return undefined;
  }
  return `${variable} ${comparator} "${typeof value === "string" ? value : ""}"`;
}

/**
 * Deserializes a chain of actions (the trunk, or a single branch/conditional
 * path) into nodes, handling nested branches/conditionals recursively.
 *
 * For each action:
 * - Regular node: link every current tail -> new node; tails become [node]; +1 row.
 * - branch/conditional node: link tails -> node; recursively deserialize each path one
 *   row further down, horizontally offset around the node's x; link node -> each
 *   path's heads; the union of all paths' tails becomes the new tail set (an empty
 *   path contributes the node itself as a tail). Rows consumed = 1 + max path rows.
 */
function deserializeChain(
  actions: unknown[],
  nodes: Record<string, IWorkflowNode>,
  link: (src: string, tgt: string, label?: string) => void,
  startRow: number,
  x: number
): ChainResult {
  let tails: string[] = [];
  let heads: string[] = [];
  let row = startRow;

  for (const raw of actions) {
    const a = raw as Record<string, unknown>;
    const activity = a["activity"] as string;
    const type = activityToNodeType(activity);
    if (!type) {
      continue;
    }

    const node = createNodeFromDefault(type, {
      x,
      y: Y_START + row * Y_STEP,
    });
    node.name = (a["name"] as string) ?? node.name;
    nodes[node.key] = node;

    for (const tail of tails) {
      link(tail, node.key);
    }
    if (heads.length === 0) {
      heads = [node.key];
    }
    row++;

    if (activity === "branch") {
      const paths = extractBranchPaths(a);
      node.configuration["branches"] = paths.map(([name]) => name);
      // Tracks, in declaration order, which paths were empty — the
      // serializer cannot recover this from graph topology alone once an
      // empty path's direct branch->converge edge is indistinguishable in
      // ordering from a real path's edge.
      node.configuration["emptyBranchFlags"] = paths.map(
        ([, actions]) => actions.length === 0
      );
      const mid = (paths.length - 1) / 2;
      const childRow = row;
      let maxPathRows = 0;
      const converge: string[] = [];

      for (let pi = 0; pi < paths.length; pi++) {
        const pathName = paths[pi][0];
        const pathX = x + (pi - mid) * X_BRANCH_GAP;
        const pathActions = paths[pi][1];
        if (pathActions.length === 0) {
          converge.push(node.key);
          continue;
        }
        const pathResult = deserializeChain(
          pathActions,
          nodes,
          link,
          childRow,
          pathX
        );
        for (const head of pathResult.heads) {
          // Edge label = the branch's own path key (e.g. "jsonplaceholder",
          // "pokeapi") — real metadata already stored verbatim in
          // node.configuration["branches"] above, not fabricated.
          link(node.key, head, pathName);
        }
        converge.push(...pathResult.tails);
        maxPathRows = Math.max(maxPathRows, pathResult.rows);
      }

      if (paths.length === 0) {
        converge.push(node.key);
      }

      tails = converge;
      row = childRow + maxPathRows;
    } else if (activity === "conditional") {
      const condBranches =
        (a["branches"] as Array<{
          label: string;
          condition: Record<string, unknown>;
          actions: unknown[];
        }>) ?? [];
      const defaultActions = a["default"] as unknown[] | undefined;
      const hasDefault =
        Array.isArray(defaultActions) && defaultActions.length > 0;

      node.configuration["branches"] = condBranches.map((b) => ({
        label: b.label,
        condition: b.condition,
      }));
      // See the analogous comment in the branch-action case above.
      node.configuration["emptyBranchFlags"] = condBranches.map(
        (b) => !(Array.isArray(b.actions) && b.actions.length > 0)
      );

      const totalPaths = condBranches.length + (hasDefault ? 1 : 0);
      const mid = (totalPaths - 1) / 2;
      const childRow = row;
      let maxPathRows = 0;
      const converge: string[] = [];

      for (let bi = 0; bi < condBranches.length; bi++) {
        const pathX = x + (bi - mid) * X_BRANCH_GAP;
        const pathActions = condBranches[bi].actions ?? [];
        if (pathActions.length === 0) {
          converge.push(node.key);
          continue;
        }
        const pathResult = deserializeChain(
          pathActions,
          nodes,
          link,
          childRow,
          pathX
        );
        for (const head of pathResult.heads) {
          // Edge label = the condition text (e.g. `request.text contains
          // "precio"`), derived verbatim from this branch's own real
          // condition rule (condBranches[bi].condition) — not fabricated.
          link(node.key, head, conditionEdgeLabel(condBranches[bi].condition));
        }
        converge.push(...pathResult.tails);
        maxPathRows = Math.max(maxPathRows, pathResult.rows);
      }

      if (hasDefault) {
        const defaultX = x + (condBranches.length - mid) * X_BRANCH_GAP;
        const pathResult = deserializeChain(
          defaultActions as unknown[],
          nodes,
          link,
          childRow,
          defaultX
        );
        if (pathResult.heads.length > 0) {
          for (const head of pathResult.heads) {
            // "default" is a literal, honest label — it IS the real
            // semantic meaning of this path (the conditional's else/default
            // branch), not an invented placeholder.
            link(node.key, head, "default");
          }
          node.configuration["default"] = {
            targetKey: pathResult.heads[0],
          };
          converge.push(...pathResult.tails);
          maxPathRows = Math.max(maxPathRows, pathResult.rows);
        }
      }

      if (condBranches.length === 0 && !hasDefault) {
        converge.push(node.key);
      }

      tails = converge;
      row = childRow + maxPathRows;
    } else {
      if (a["args"] && typeof a["args"] === "object") {
        node.configuration = {
          ...node.configuration,
          ...(a["args"] as Record<string, unknown>),
        };
      }
      tails = [node.key];
    }

    if (activity === "channelSend") {
      node.configuration["direction"] = "outbound";
      const args = a["args"] as Record<string, unknown> | undefined;
      if (args) {
        node.configuration["messageType"] = args["type"] ?? "text";
      }
      const to = node.configuration["to"] as string | undefined;
      node.configuration["recipientMode"] =
        to === "{{request.from}}" ? "sender" : "custom";
    }
  }

  return { heads, tails, rows: row - startRow };
}

function activityToNodeType(activity: string): EWorkflowNodeType | null {
  const map: Record<string, EWorkflowNodeType> = {
    jsFunction: EWorkflowNodeType.JS_FUNCTION,
    endpointCall: EWorkflowNodeType.ENDPOINT_CALL,
    mcpCall: EWorkflowNodeType.MCP_CALL,
    serviceCall: EWorkflowNodeType.SERVICE_CALL,
    serviceBusCall: EWorkflowNodeType.SERVICE_BUS_CALL,
    agentCall: EWorkflowNodeType.AGENT_CALL,
    channelSend: EWorkflowNodeType.CHANNEL,
    branch: EWorkflowNodeType.BRANCH,
    conditional: EWorkflowNodeType.CONDITIONAL,
  };
  return map[activity] ?? null;
}
