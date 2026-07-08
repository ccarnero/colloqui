import {
  EWorkflowConnectionType,
  EWorkflowNodeType,
  type IWorkflowConnection,
  type IWorkflowNode,
} from "./workflow-node.types";
import { createNodeFromDefault } from "./workflow-node-defaults";

const X_START = 50;
const X_GAP = 280;
const Y_BASE = 100;
const Y_BRANCH_GAP = 140;

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

  const link = (src: string, tgt: string): void => {
    const key = `conn-r-${connSeq++}`;
    connections[key] = {
      key,
      source: src,
      target: tgt,
      type: EWorkflowConnectionType.DEFAULT,
    };
  };

  let tails: string[] = [];
  let col = 0;

  if (dto.trigger) {
    const tn = createNodeFromDefault(EWorkflowNodeType.CHANNEL, {
      x: X_START,
      y: Y_BASE,
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
    col++;
  }

  if (Array.isArray(dto.actions)) {
    const result = deserializeChain(dto.actions, nodes, link, col, Y_BASE);
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
  /** Number of X_GAP columns consumed by this chain, starting at the given startCol. */
  columns: number;
}

/**
 * Deserializes a chain of actions (the trunk, or a single branch/conditional
 * path) into nodes, handling nested branches/conditionals recursively.
 *
 * For each action:
 * - Regular node: link every current tail -> new node; tails become [node]; +1 column.
 * - branch/conditional node: link tails -> node; recursively deserialize each path one
 *   column to the right, vertically offset around the node's y; link node -> each
 *   path's heads; the union of all paths' tails becomes the new tail set (an empty
 *   path contributes the node itself as a tail). Columns consumed = 1 + max path columns.
 */
function deserializeChain(
  actions: unknown[],
  nodes: Record<string, IWorkflowNode>,
  link: (src: string, tgt: string) => void,
  startCol: number,
  y: number
): ChainResult {
  let tails: string[] = [];
  let heads: string[] = [];
  let col = startCol;

  for (const raw of actions) {
    const a = raw as Record<string, unknown>;
    const activity = a["activity"] as string;
    const type = activityToNodeType(activity);
    if (!type) {
      continue;
    }

    const node = createNodeFromDefault(type, {
      x: X_START + col * X_GAP,
      y,
    });
    node.name = (a["name"] as string) ?? node.name;
    nodes[node.key] = node;

    for (const tail of tails) {
      link(tail, node.key);
    }
    if (heads.length === 0) {
      heads = [node.key];
    }
    col++;

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
      const childCol = col;
      let maxPathCols = 0;
      const converge: string[] = [];

      for (let pi = 0; pi < paths.length; pi++) {
        const pathY = y + (pi - mid) * Y_BRANCH_GAP;
        const pathActions = paths[pi][1];
        if (pathActions.length === 0) {
          converge.push(node.key);
          continue;
        }
        const pathResult = deserializeChain(
          pathActions,
          nodes,
          link,
          childCol,
          pathY
        );
        for (const head of pathResult.heads) {
          link(node.key, head);
        }
        converge.push(...pathResult.tails);
        maxPathCols = Math.max(maxPathCols, pathResult.columns);
      }

      if (paths.length === 0) {
        converge.push(node.key);
      }

      tails = converge;
      col = childCol + maxPathCols;
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
      const childCol = col;
      let maxPathCols = 0;
      const converge: string[] = [];

      for (let bi = 0; bi < condBranches.length; bi++) {
        const pathY = y + (bi - mid) * Y_BRANCH_GAP;
        const pathActions = condBranches[bi].actions ?? [];
        if (pathActions.length === 0) {
          converge.push(node.key);
          continue;
        }
        const pathResult = deserializeChain(
          pathActions,
          nodes,
          link,
          childCol,
          pathY
        );
        for (const head of pathResult.heads) {
          link(node.key, head);
        }
        converge.push(...pathResult.tails);
        maxPathCols = Math.max(maxPathCols, pathResult.columns);
      }

      if (hasDefault) {
        const defaultY = y + (condBranches.length - mid) * Y_BRANCH_GAP;
        const pathResult = deserializeChain(
          defaultActions as unknown[],
          nodes,
          link,
          childCol,
          defaultY
        );
        if (pathResult.heads.length > 0) {
          for (const head of pathResult.heads) {
            link(node.key, head);
          }
          node.configuration["default"] = {
            targetKey: pathResult.heads[0],
          };
          converge.push(...pathResult.tails);
          maxPathCols = Math.max(maxPathCols, pathResult.columns);
        }
      }

      if (condBranches.length === 0 && !hasDefault) {
        converge.push(node.key);
      }

      tails = converge;
      col = childCol + maxPathCols;
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

  return { heads, tails, columns: col - startCol };
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
