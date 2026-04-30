export enum EWorkflowNodeType {
  CHANNEL = "channel",
  JS_FUNCTION = "jsFunction",
  ENDPOINT_CALL = "endpointCall",
  SERVICE_CALL = "serviceCall",
  SERVICE_BUS_CALL = "serviceBusCall",
  AGENT_CALL = "agentCall",
  BRANCH = "branch",
}

export enum EWorkflowConnectionType {
  DEFAULT = "default",
  BRANCH = "branch",
}

export interface IWorkflowNode {
  key: string;
  type: EWorkflowNodeType;
  name: string;
  icon: string;
  position: { x: number; y: number };
  configuration: Record<string, unknown>;
}

export interface IWorkflowConnection {
  key: string;
  source: string;
  target: string;
  type: EWorkflowConnectionType;
  label?: string;
}

export interface IWorkflowFlow {
  key: string;
  name: string;
  application: string;
  nodes: Record<string, IWorkflowNode>;
  connections: Record<string, IWorkflowConnection>;
}
