import {
  EWorkflowNodeType,
  type IWorkflowFlow,
  type IWorkflowNode,
  type IWorkflowConnection,
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
      mode:
        (inboundNode.configuration["mode"] as string) ?? "shared",
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
    return { name: flow.name, application: flow.application, actions: [], trigger };
  }

  const visited = new Set<string>();
  const actions = walkActions(startKey, nodes, outgoing, visited);

  return {
    name: flow.name,
    application: flow.application,
    actions,
    trigger,
  };
}

function buildAdjacencyMap(
  connections: Record<string, IWorkflowConnection>,
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
  connections: Record<string, IWorkflowConnection>,
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
  nodes: Record<string, IWorkflowNode>,
): IWorkflowNode | undefined {
  return Object.values(nodes).find(
    (n) =>
      n.type === EWorkflowNodeType.CHANNEL &&
      n.configuration["direction"] === "inbound",
  );
}

function findRootNode(
  nodes: Record<string, IWorkflowNode>,
  incoming: Map<string, string[]>,
): string | undefined {
  for (const key of Object.keys(nodes)) {
    if (!incoming.has(key)) return key;
  }
  return Object.keys(nodes)[0];
}

function walkActions(
  startKey: string,
  nodes: Record<string, IWorkflowNode>,
  outgoing: Map<string, string[]>,
  visited: Set<string>,
): WorkflowAction[] {
  const actions: WorkflowAction[] = [];
  let current: string | undefined = startKey;

  while (current && !visited.has(current)) {
    visited.add(current);
    const node = nodes[current];
    if (!node) break;

    const isInboundChannel =
      node.type === EWorkflowNodeType.CHANNEL &&
      node.configuration["direction"] === "inbound";

    if (!isInboundChannel) {
      const action = nodeToAction(node, nodes, outgoing, visited);
      if (action) actions.push(action);
    }

    const targets = outgoing.get(current);
    if (!targets || targets.length === 0) break;

    if (node.type === EWorkflowNodeType.BRANCH) {
      break;
    }

    current = targets[0];
  }

  return actions;
}

function nodeToAction(
  node: IWorkflowNode,
  nodes: Record<string, IWorkflowNode>,
  outgoing: Map<string, string[]>,
  visited: Set<string>,
): WorkflowAction | null {
  switch (node.type) {
    case EWorkflowNodeType.CHANNEL:
      return {
        activity: "channelSend",
        name: node.name,
        args: {
          accountId:
            (node.configuration["accountId"] as string) ?? "",
          channel:
            (node.configuration["channel"] as string) ?? "",
          provider:
            (node.configuration["provider"] as string) ?? "",
          to: (node.configuration["to"] as string) ?? "",
          type:
            (node.configuration["messageType"] as string) ??
            "text",
          text: node.configuration["text"] ?? undefined,
          templateName:
            node.configuration["templateName"] ?? undefined,
          templateLanguage:
            node.configuration["templateLanguage"] ?? undefined,
          mediaUrl:
            node.configuration["mediaUrl"] ?? undefined,
          caption:
            node.configuration["caption"] ?? undefined,
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

    case EWorkflowNodeType.BRANCH: {
      const targets = outgoing.get(node.key) ?? [];
      const branchAction: WorkflowAction = {
        activity: "branch",
        name: node.name,
      };

      for (let i = 0; i < targets.length; i++) {
        const branchName =
          (node.configuration["branches"] as string[])?.[i] ??
          `path${i}`;
        branchAction[branchName] = walkActions(
          targets[i],
          nodes,
          outgoing,
          visited,
        );
      }

      return branchAction;
    }

    default:
      return null;
  }
}
