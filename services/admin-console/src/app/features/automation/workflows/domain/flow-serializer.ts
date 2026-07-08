import {
  EWorkflowNodeType,
  type IConditionalBranchConfig,
  type IWorkflowConnection,
  type IWorkflowFlow,
  type IWorkflowNode,
} from "./workflow-node.types";

interface WorkflowAction {
  activity: string;
  name: string;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

interface WorkflowTrigger {
  type: string;
  mode: string;
  config: Record<string, unknown>;
}

interface SerializedWorkflow {
  name: string;
  application: string;
  actions: WorkflowAction[];
  trigger?: WorkflowTrigger;
}

/**
 * Serializes a visual flow graph into the backend WorkflowDefinition
 * shape (linear action array with nested branch actions).
 */
export function serializeFlow(flow: IWorkflowFlow): SerializedWorkflow {
  const outgoing = buildAdjacencyMap(flow.connections);
  const incoming = buildReverseAdjacencyMap(flow.connections);
  const nodes = flow.nodes;

  const inboundNode = findInboundChannelNode(nodes);
  let trigger: WorkflowTrigger | undefined;

  if (inboundNode) {
    trigger = {
      type: "message_received",
      mode: (inboundNode.configuration["mode"] as string) ?? "shared",
      config: {
        accountIds: inboundNode.configuration["accountIds"] ?? [],
        channels: inboundNode.configuration["channels"] ?? [],
        providers: inboundNode.configuration["providers"] ?? [],
        patterns: inboundNode.configuration["patterns"] ?? [],
      },
    };
  }

  const startKey = inboundNode?.key ?? findRootNode(nodes, incoming);
  if (!startKey) {
    return {
      name: flow.name,
      application: flow.application,
      actions: [],
      trigger,
    };
  }

  const visited = new Set<string>();
  const actions = walkTrunk(startKey, nodes, outgoing, incoming, visited);

  return {
    name: flow.name,
    application: flow.application,
    actions,
    trigger,
  };
}

function buildAdjacencyMap(
  connections: Record<string, IWorkflowConnection>
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const conn of Object.values(connections)) {
    const list = map.get(conn.source);
    if (list) {
      list.push(conn.target);
    } else {
      map.set(conn.source, [conn.target]);
    }
  }
  return map;
}

function buildReverseAdjacencyMap(
  connections: Record<string, IWorkflowConnection>
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const conn of Object.values(connections)) {
    const list = map.get(conn.target);
    if (list) {
      list.push(conn.source);
    } else {
      map.set(conn.target, [conn.source]);
    }
  }
  return map;
}

function findInboundChannelNode(
  nodes: Record<string, IWorkflowNode>
): IWorkflowNode | undefined {
  return Object.values(nodes).find(
    (n) =>
      n.type === EWorkflowNodeType.CHANNEL &&
      n.configuration["direction"] === "inbound"
  );
}

function findRootNode(
  nodes: Record<string, IWorkflowNode>,
  incoming: Map<string, string[]>
): string | undefined {
  for (const key of Object.keys(nodes)) {
    if (!incoming.has(key)) {
      return key;
    }
  }
  return Object.keys(nodes)[0];
}

/** A node with 2+ incoming connections is a fan-in/converge point. */
function isConvergePoint(
  key: string,
  incoming: Map<string, string[]>
): boolean {
  return (incoming.get(key)?.length ?? 0) >= 2;
}

/**
 * Walks the main trunk of the flow starting at `startKey`. Unlike a path
 * walk, the trunk never stops at a converge point — when it hits a
 * BRANCH/CONDITIONAL it emits that action (which internally walks each of
 * its paths and discovers the shared converge point) and then CONTINUES
 * the trunk at that converge point, if one was found.
 */
function walkTrunk(
  startKey: string,
  nodes: Record<string, IWorkflowNode>,
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>,
  visited: Set<string>
): WorkflowAction[] {
  const actions: WorkflowAction[] = [];
  let current: string | undefined = startKey;

  while (current && !visited.has(current)) {
    visited.add(current);
    const node = nodes[current];
    if (!node) {
      break;
    }

    const isInboundChannel =
      node.type === EWorkflowNodeType.CHANNEL &&
      node.configuration["direction"] === "inbound";

    if (!isInboundChannel) {
      if (
        node.type === EWorkflowNodeType.BRANCH ||
        node.type === EWorkflowNodeType.CONDITIONAL
      ) {
        const { action, convergeKey } = branchLikeToAction(
          node,
          nodes,
          outgoing,
          incoming,
          visited
        );
        actions.push(action);

        if (convergeKey) {
          current = convergeKey;
          continue;
        }
        // Terminal branch/conditional: no shared next action.
        break;
      }

      const action = nodeToAction(node);
      if (action) {
        actions.push(action);
      }
    }

    const targets = outgoing.get(current);
    if (!targets || targets.length === 0) {
      break;
    }

    current = targets[0];
  }

  return actions;
}

/**
 * Walks a single branch/conditional path starting at `startKey`. Stops
 * (without emitting) as soon as it reaches a converge point (a node with
 * 2+ incoming connections) — that node belongs to the enclosing scope, not
 * to this path — and reports it as `convergeKey` so the caller can resume
 * the trunk (or an outer path) from there. Nested branches/conditionals
 * inside the path are handled the same way the trunk handles them: the
 * nested action is emitted and the path walk continues at the nested
 * converge point, which naturally bubbles up if it turns out to be shared
 * with sibling paths too.
 */
function walkPath(
  startKey: string,
  nodes: Record<string, IWorkflowNode>,
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>,
  visited: Set<string>
): { actions: WorkflowAction[]; convergeKey?: string } {
  const actions: WorkflowAction[] = [];
  let current: string | undefined = startKey;

  while (current) {
    if (isConvergePoint(current, incoming)) {
      return { actions, convergeKey: current };
    }
    if (visited.has(current)) {
      // Already emitted by another path (shouldn't normally happen for a
      // node with fewer than 2 incoming edges, but guard against cycles).
      return { actions, convergeKey: undefined };
    }

    const node = nodes[current];
    if (!node) {
      break;
    }
    visited.add(current);

    if (
      node.type === EWorkflowNodeType.BRANCH ||
      node.type === EWorkflowNodeType.CONDITIONAL
    ) {
      const { action, convergeKey } = branchLikeToAction(
        node,
        nodes,
        outgoing,
        incoming,
        visited
      );
      actions.push(action);
      if (!convergeKey) {
        return { actions, convergeKey: undefined };
      }
      current = convergeKey;
      continue;
    }

    const action = nodeToAction(node);
    if (action) {
      actions.push(action);
    }

    const targets = outgoing.get(current);
    if (!targets || targets.length === 0) {
      return { actions, convergeKey: undefined };
    }
    current = targets[0];
  }

  return { actions, convergeKey: undefined };
}

/** True when a path walk stopped immediately because the target itself is the converge point. */
function isEmptyDirectPath(
  target: string,
  result: { actions: WorkflowAction[]; convergeKey?: string }
): boolean {
  return result.actions.length === 0 && result.convergeKey === target;
}

function branchLikeToAction(
  node: IWorkflowNode,
  nodes: Record<string, IWorkflowNode>,
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>,
  visited: Set<string>
): { action: WorkflowAction; convergeKey?: string } {
  return node.type === EWorkflowNodeType.CONDITIONAL
    ? conditionalToAction(node, nodes, outgoing, incoming, visited)
    : branchToAction(node, nodes, outgoing, incoming, visited);
}

function branchToAction(
  node: IWorkflowNode,
  nodes: Record<string, IWorkflowNode>,
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>,
  visited: Set<string>
): { action: WorkflowAction; convergeKey?: string } {
  const targets = outgoing.get(node.key) ?? [];
  const branchNames = (node.configuration["branches"] as string[]) ?? [];
  const emptyFlags =
    (node.configuration["emptyBranchFlags"] as boolean[] | undefined) ??
    branchNames.map(() => false);
  // Real (non-empty) path edges are always created before the direct
  // branch->converge edges during deserialization (see flow-deserializer.ts:
  // the path loop links real path heads immediately, while empty-path
  // convergence links are only added later, when the trunk continues at the
  // next action). So walking `targets` in order and consuming names from
  // these two declaration-order-preserving queues keeps each name paired
  // with its correct content, even when empty and non-empty paths are
  // interleaved in the original declaration.
  const nonEmptyNames = branchNames.filter((_, i) => !emptyFlags[i]);
  const emptyNames = branchNames.filter((_, i) => emptyFlags[i]);
  const branchAction: WorkflowAction = {
    activity: "branch",
    name: node.name,
  };

  const convergeCandidates = new Set<string>();
  let nonEmptyPtr = 0;
  let emptyPtr = 0;

  for (const target of targets) {
    const result = walkPath(target, nodes, outgoing, incoming, visited);

    if (isEmptyDirectPath(target, result)) {
      // Direct branch -> converge edge: an empty path.
      const name = emptyNames[emptyPtr] ?? `emptyPath${emptyPtr}`;
      emptyPtr++;
      branchAction[name] = [];
      convergeCandidates.add(target);
      continue;
    }

    const name = nonEmptyNames[nonEmptyPtr] ?? `path${nonEmptyPtr}`;
    nonEmptyPtr++;
    branchAction[name] = result.actions;
    if (result.convergeKey) {
      convergeCandidates.add(result.convergeKey);
    }
  }

  const convergeKey =
    convergeCandidates.size === 1 ? [...convergeCandidates][0] : undefined;

  return { action: branchAction, convergeKey };
}

function conditionalToAction(
  node: IWorkflowNode,
  nodes: Record<string, IWorkflowNode>,
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>,
  visited: Set<string>
): { action: WorkflowAction; convergeKey?: string } {
  const targets = outgoing.get(node.key) ?? [];
  const branchConfigs =
    (node.configuration["branches"] as IConditionalBranchConfig[]) ?? [];
  const emptyFlags =
    (node.configuration["emptyBranchFlags"] as boolean[] | undefined) ??
    branchConfigs.map(() => false);
  const defaultConfig = node.configuration["default"] as
    | { targetKey?: string }
    | undefined;

  const convergeCandidates = new Set<string>();
  const branches: Array<{
    label: string;
    condition: IConditionalBranchConfig["condition"];
    actions: WorkflowAction[];
  }> = [];

  // The default path's target is stored explicitly in configuration, so we
  // exclude it from the plain condition-branch targets before pairing them
  // positionally with `branchConfigs`. As with branchToAction, real
  // (non-empty) branch edges are always created before empty-branch direct
  // convergence edges, so two declaration-order queues keep each label
  // paired with its correct content.
  const conditionTargets = targets.filter(
    (t) => t !== defaultConfig?.targetKey
  );
  const nonEmptyConfigs = branchConfigs.filter((_, i) => !emptyFlags[i]);
  const emptyConfigs = branchConfigs.filter((_, i) => emptyFlags[i]);

  let nonEmptyPtr = 0;
  let emptyPtr = 0;
  for (const target of conditionTargets) {
    const result = walkPath(target, nodes, outgoing, incoming, visited);

    if (isEmptyDirectPath(target, result)) {
      const cfg = emptyConfigs[emptyPtr];
      emptyPtr++;
      if (cfg) {
        branches.push({
          label: cfg.label,
          condition: cfg.condition as IConditionalBranchConfig["condition"],
          actions: [],
        });
      }
      convergeCandidates.add(target);
      continue;
    }

    const cfg = nonEmptyConfigs[nonEmptyPtr];
    nonEmptyPtr++;
    branches.push({
      label: cfg?.label ?? `path${nonEmptyPtr - 1}`,
      condition: cfg?.condition as IConditionalBranchConfig["condition"],
      actions: result.actions,
    });
    if (result.convergeKey) {
      convergeCandidates.add(result.convergeKey);
    }
  }

  let defaultActions: WorkflowAction[] | undefined;
  if (defaultConfig?.targetKey) {
    const result = walkPath(
      defaultConfig.targetKey,
      nodes,
      outgoing,
      incoming,
      visited
    );
    if (!isEmptyDirectPath(defaultConfig.targetKey, result)) {
      defaultActions = result.actions;
    }
    if (result.convergeKey) {
      convergeCandidates.add(result.convergeKey);
    }
  }

  const convergeKey =
    convergeCandidates.size === 1 ? [...convergeCandidates][0] : undefined;

  return {
    action: {
      activity: "conditional",
      name: node.name,
      branches,
      ...(defaultActions && defaultActions.length > 0
        ? { default: defaultActions }
        : {}),
    },
    convergeKey,
  };
}

function nodeToAction(node: IWorkflowNode): WorkflowAction | null {
  switch (node.type) {
    case EWorkflowNodeType.CHANNEL:
      return {
        activity: "channelSend",
        name: node.name,
        args: {
          accountId: (node.configuration["accountId"] as string) ?? "",
          channel: (node.configuration["channel"] as string) ?? "",
          provider: (node.configuration["provider"] as string) ?? "",
          to: (node.configuration["to"] as string) ?? "",
          type: (node.configuration["messageType"] as string) ?? "text",
          text: node.configuration["text"] ?? undefined,
          templateName: node.configuration["templateName"] ?? undefined,
          templateLanguage: node.configuration["templateLanguage"] ?? undefined,
          mediaUrl: node.configuration["mediaUrl"] ?? undefined,
          caption: node.configuration["caption"] ?? undefined,
        },
      };

    case EWorkflowNodeType.JS_FUNCTION:
      return {
        activity: "jsFunction",
        name: node.name,
        args: { code: node.configuration["code"] ?? "" },
      };

    case EWorkflowNodeType.ENDPOINT_CALL:
      return {
        activity: "endpointCall",
        name: node.name,
        args: {
          method: node.configuration["method"] ?? "GET",
          url: node.configuration["url"] ?? "",
          adapterId: node.configuration["adapterId"] ?? undefined,
          endpointId: node.configuration["endpointId"] ?? undefined,
          data: node.configuration["data"] ?? undefined,
          headers: node.configuration["headers"] ?? undefined,
        },
      };

    case EWorkflowNodeType.MCP_CALL:
      return {
        activity: "mcpCall",
        name: node.name,
        args: {
          serverId: (node.configuration["serverId"] as string) ?? "",
          toolName: (node.configuration["toolName"] as string) ?? "",
          params: node.configuration["params"] ?? undefined,
        },
      };

    case EWorkflowNodeType.SERVICE_CALL:
      return {
        activity: "serviceCall",
        name: node.name,
        args: {
          serviceId: node.configuration["serviceId"] ?? "",
          method: node.configuration["method"] ?? "GET",
          path: node.configuration["path"] ?? "/",
          data: node.configuration["data"] ?? undefined,
          headers: node.configuration["headers"] ?? undefined,
        },
      };

    case EWorkflowNodeType.SERVICE_BUS_CALL:
      return {
        activity: "serviceBusCall",
        name: node.name,
        args: {
          subject: node.configuration["subject"] ?? "",
          payload: node.configuration["payload"] ?? undefined,
        },
      };

    case EWorkflowNodeType.AGENT_CALL: {
      const conv = node.configuration["conversationId"];
      const cust = node.configuration["customerName"];
      const uid = node.configuration["userId"];
      const ch = node.configuration["channel"];
      return {
        activity: "agentCall",
        name: node.name,
        args: {
          agentId: (node.configuration["agentId"] as string) ?? "",
          message: (node.configuration["message"] as string) ?? "",
          ...(typeof conv === "string" && conv.length > 0
            ? { conversationId: conv }
            : {}),
          ...(typeof cust === "string" && cust.length > 0
            ? { customerName: cust }
            : {}),
          ...(typeof uid === "string" && uid.length > 0 ? { userId: uid } : {}),
          ...(typeof ch === "string" && ch.length > 0 ? { channel: ch } : {}),
        },
      };
    }

    default:
      return null;
  }
}
