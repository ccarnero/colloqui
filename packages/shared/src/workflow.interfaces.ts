import type { Channel, ChannelProvider } from "./channel.interfaces";

// ── Execution context ──────────────────────────────────────────────

export interface WorkflowExecutionContext {
  workflow: { name: string; tenant: string; application: string };
  request: Record<string, unknown>;
  results: Record<string, unknown>;
}

// ── Activity arguments ─────────────────────────────────────────────

export interface EndpointCallArgs {
  method: string;
  url: string;
  adapterId?: string;
  endpointId?: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
}

export interface JsFunctionArgs {
  code: string;
}

export interface ServiceBusCallArgs {
  subject: string;
  payload?: unknown;
  headers?: Record<string, string>;
}

export interface ServiceCallArgs {
  serviceId: string;
  method: string;
  path: string;
  data?: unknown;
  headers?: Record<string, string>;
}

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

/** Matches YoizenClaw admin chat request context entries. */
export interface AgentCallContextEntry {
  sender: "customer" | "agent";
  content: string;
}

/** YoizenClaw agent chat (`POST /admin/agents/:id/chat`). */
export interface AgentCallArgs {
  agentId: string;
  message: string;
  conversationId?: string;
  customerName?: string;
  userId?: string;
  channel?: string;
  context?: AgentCallContextEntry[];
}

// ── Activity actions ───────────────────────────────────────────────

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

// ── Triggers ───────────────────────────────────────────────────────

export type TriggerMode = "exclusive" | "shared";

export interface MessageReceivedTriggerConfig {
  accountIds?: string[];
  channels?: Channel[];
  providers?: ChannelProvider[];
  patterns?: string[];
}

export interface MessageReceivedTrigger {
  type: "message_received";
  mode: TriggerMode;
  config: MessageReceivedTriggerConfig;
}

export type WorkflowTrigger = MessageReceivedTrigger;

// ── Workflow definition ────────────────────────────────────────────

export interface WorkflowDefinition {
  name: string;
  tenant: string;
  application: string;
  request: Record<string, unknown>;
  actions: WorkflowAction[];
  trigger?: WorkflowTrigger;
}
