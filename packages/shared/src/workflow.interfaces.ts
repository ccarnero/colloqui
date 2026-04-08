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
