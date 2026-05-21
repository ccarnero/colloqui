export interface EventCausalContext {
  readonly causation_id: string;
  readonly correlation_id: string;
  readonly depth: number;
}

export interface WorkflowExecutionContext {
  workflow: { name: string; tenant: string; application: string };
  request: Record<string, unknown>;
  results: Record<string, unknown>;
  causal?: EventCausalContext;
}

export interface HttpEndpointRequest {
  method: string;
  url: string;
  adapterId?: string;
  endpointId?: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
}

export interface HttpServiceRequest {
  serviceId: string;
  method: string;
  path: string;
  data?: unknown;
  headers?: Record<string, string>;
  endpointId?: string;
}

export interface AgentChatContextEntry {
  sender: "customer" | "agent";
  content: string;
}

export interface AgentChatRequest {
  agentId: string;
  message: string;
  conversationId?: string;
  customerName?: string;
  userId?: string;
  channel?: string;
  context?: AgentChatContextEntry[];
}

export interface HttpExecutionResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

export interface JsFunctionArgs {
  code: string;
}

export interface ServiceBusCallArgs {
  subject: string;
  payload?: unknown;
  headers?: Record<string, string>;
}

export type Channel = "whatsapp" | "instagram" | "telegram";
export type ChannelProvider = "meta" | "telegram";

export interface ChannelSendArgs {
  accountId: string;
  channel: Channel;
  provider: ChannelProvider;
  to: string;
  type: "text" | "template" | "image" | "document";
  text?: string;
  templateName?: string;
  templateLanguage?: string;
  templateComponents?: Record<string, unknown>[];
  mediaUrl?: string;
  caption?: string;
}

export type EndpointCallArgs = HttpEndpointRequest;
export type ServiceCallArgs = HttpServiceRequest;
export type AgentCallArgs = AgentChatRequest;

export interface EndpointCallAction {
  activity: "endpointCall";
  name: string;
  args: EndpointCallArgs;
}

export interface JsFunctionAction {
  activity: "jsFunction";
  name: string;
  args: JsFunctionArgs;
}

export interface ServiceBusCallAction {
  activity: "serviceBusCall";
  name: string;
  args: ServiceBusCallArgs;
}

export interface ServiceCallAction {
  activity: "serviceCall";
  name: string;
  args: ServiceCallArgs;
}

export interface ChannelSendAction {
  activity: "channelSend";
  name: string;
  args: ChannelSendArgs;
}

export interface AgentCallAction {
  activity: "agentCall";
  name: string;
  args: AgentCallArgs;
}

export interface BranchAction {
  activity: "branch";
  name: string;
  [branchName: string]: WorkflowAction[] | string;
}

export type WorkflowAction =
  | EndpointCallAction
  | JsFunctionAction
  | ServiceBusCallAction
  | ServiceCallAction
  | ChannelSendAction
  | AgentCallAction
  | BranchAction;

export interface WorkflowDefinition {
  name: string;
  tenant: string;
  application: string;
  request: Record<string, unknown>;
  actions: WorkflowAction[];
  causal?: EventCausalContext;
}
