import type { Channel, ChannelProvider } from "./channel.interfaces";
import type {
  AgentChatRequest,
  HttpEndpointRequest,
  HttpServiceRequest,
  AgentChatContextEntry,
} from "./http-execution.interfaces";

// ── Causal chain propagation (D11 / D12) ───────────────────────────

/**
 * Causal-chain metadata inherited from the event that triggered this
 * workflow run. Threaded from the trigger source (e.g. the ingress
 * envelope consumed by `TriggerConsumerService`) through
 * {@link WorkflowDefinition}, {@link WorkflowExecutionContext}, and
 * finally into publishing activities so derived envelopes comply with
 * §6 of wdocs-02:
 *
 *  - `causation_id` of a new envelope must equal `incoming.id`.
 *  - `correlation_id` must be copied from `incoming.correlation_id`.
 *  - `transport.depth = incoming.transport.depth + 1`.
 *
 * All fields are optional so workflows started directly over HTTP (no
 * upstream envelope) keep behaving as roots (`causation_id = null`).
 */
export interface EventCausalContext {
  readonly causation_id: string;
  readonly correlation_id: string;
  readonly depth: number;
}

// ── Execution context ──────────────────────────────────────────────

export interface WorkflowExecutionContext {
  workflow: { name: string; tenant: string; application: string };
  request: Record<string, unknown>;
  results: Record<string, unknown>;
  /**
   * Present only when the workflow was started from an event on the
   * bus. Consumed by activities that publish derived envelopes (e.g.
   * `channelSend`). `undefined` means "this run is a causal root".
   */
  causal?: EventCausalContext;
}

// ── Activity arguments ─────────────────────────────────────────────

export type EndpointCallArgs = HttpEndpointRequest;

export interface JsFunctionArgs {
  code: string;
}

export interface ServiceBusCallArgs {
  subject: string;
  payload?: unknown;
  headers?: Record<string, string>;
}

export type ServiceCallArgs = HttpServiceRequest;

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

export type AgentCallContextEntry = AgentChatContextEntry;

export type AgentCallArgs = AgentChatRequest;

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
  /**
   * Optional causal chain inherited from the triggering envelope.
   * When present it is threaded into
   * {@link WorkflowExecutionContext.causal} by `runWorkflow`.
   */
  causal?: EventCausalContext;
}
