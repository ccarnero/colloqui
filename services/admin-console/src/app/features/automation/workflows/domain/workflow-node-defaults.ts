import { EWorkflowNodeType } from "./workflow-node.types";
import type { IWorkflowNode } from "./workflow-node.types";

export interface INodeDefault {
  name: string;
  icon: string;
  group: string;
  configuration: Record<string, unknown>;
}

export const DEFAULT_NODE_MAP: Record<EWorkflowNodeType, INodeDefault> = {
  [EWorkflowNodeType.CHANNEL]: {
    name: "Channel",
    icon: "swap_horiz",
    group: "Channels",
    configuration: {
      direction: "inbound",
      accountIds: [],
      channels: [],
      providers: [],
      patterns: [],
      mode: "shared",
      accountId: "",
      channel: "",
      provider: "",
      recipientMode: "sender",
      to: "{{request.from}}",
      messageType: "text",
      text: "",
    },
  },
  [EWorkflowNodeType.JS_FUNCTION]: {
    name: "JS Function",
    icon: "code",
    group: "Logic",
    configuration: { code: "" },
  },
  [EWorkflowNodeType.ENDPOINT_CALL]: {
    name: "HTTP Connector",
    icon: "http",
    group: "Integrations",
    configuration: {
      method: "GET",
      url: "",
      adapterId: "",
      endpointId: "",
    },
  },
  // Optional `data` (JSON body) is edited in the builder for POST/PUT/PATCH; GET/DELETE ignore it.
  [EWorkflowNodeType.SERVICE_CALL]: {
    name: "Service Call",
    icon: "dns",
    group: "Integrations",
    configuration: {
      serviceId: "",
      method: "GET",
      path: "/",
    },
  },
  [EWorkflowNodeType.SERVICE_BUS_CALL]: {
    name: "Publish Event",
    icon: "send",
    group: "Integrations",
    configuration: { subject: "", payload: null },
  },
  [EWorkflowNodeType.AGENT_CALL]: {
    name: "Agent",
    icon: "smart_toy",
    group: "AI",
    configuration: {
      agentId: "",
      message: "",
      conversationId: "",
    },
  },
  [EWorkflowNodeType.BRANCH]: {
    name: "Parallel Branch",
    icon: "call_split",
    group: "Flow Control",
    configuration: { branches: ["pathA", "pathB"] },
  },
  [EWorkflowNodeType.CONDITIONAL]: {
    name: "Conditional",
    icon: "alt_route",
    group: "Flow Control",
    configuration: {
      branches: [],
    },
  },
};

let nextId = 1;

export function createNodeFromDefault(
  type: EWorkflowNodeType,
  position: { x: number; y: number },
): IWorkflowNode {
  const defaults = DEFAULT_NODE_MAP[type];
  return {
    key: `node-${Date.now()}-${nextId++}`,
    type,
    name: defaults.name,
    icon: defaults.icon,
    position,
    configuration: { ...defaults.configuration },
  };
}
