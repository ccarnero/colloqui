import type { Channel, ChannelProvider } from "./channel.interfaces";

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

/**
 * Arguments for the `endpointCall` activity. Three valid shapes:
 *
 *  1. `adapterId` + `endpointId` → fully adapter-resolved (method,
 *     path, headers, auth, timeouts all come from the adapter).
 *     `url` is ignored in this mode.
 *  2. `adapterId` (no `endpointId`) + `url` as a path (e.g. `/resource`)
 *     → adapter's `baseUrl` is joined with `url`, `method` is honoured.
 *     Adapter headers/auth/timeouts/retries still apply.
 *  3. No `adapterId` → `url` MUST be absolute (`http(s)://…`). Fixed
 *     30 s timeout, no retries.
 *
 * Shape (1) and (3) are the production-normalised forms; shape (2)
 * exists to support UI flows that pre-select an adapter but let the
 * user type an ad-hoc path without registering an endpoint upfront.
 */
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
  /**
   * Explicit JetStream dedup key (`Nats-Msg-Id` + `msgID`). When
   * absent, `executeServiceBusCall` derives a deterministic hash from
   * `{ subject, payload, headers }` so Temporal activity retries
   * collapse to a single stream entry inside `duplicate_window`
   * (2026-05-22 post-mortem §P1.3, fix 1).
   *
   * Workflows that want to *force* a new delivery on each retry
   * (rare — e.g. fire-and-forget telemetry pulses where dedup would
   * lose datapoints) should pass a per-call unique value.
   */
  dedupKey?: string;
}

export interface ServiceCallArgs {
  /** Stable id of the row in `registered_services` (UUID, never the slug). */
  serviceId: string;
  /**
   * Resolved registry slug (`registered_services.name`, e.g. `echo-service`).
   * Pre-populated by `workflow-service` at start time so the activity can
   * hit the adapter mirror by `name=slug` in O(1) without a registry
   * round-trip. The mirror table key is the slug — without it we always
   * fall back to the registry path (1 extra HTTP hop per activity).
   *
   * Optional for backwards-compat: pre-Option-A workflow definitions
   * persisted to the DB do not carry it. When absent, the activity uses
   * `serviceId` for the mirror lookup, which deterministically misses
   * and falls back through the registry — same behaviour as before.
   */
  serviceSlug?: string;
  method: string;
  path: string;
  data?: unknown;
  headers?: Record<string, string>;
  /**
   * Optional endpoint id from the internal-adapter mirror. When provided,
   * the worker resolves the request through {@link AdapterClient} and
   * uses the endpoint's pre-declared method/path (see wdocs D-service-adapter).
   * When absent, the worker falls back to concatenating `args.path` onto
   * the mirror's `baseUrl` (hybrid mode).
   */
  endpointId?: string;
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
  /**
   * Optional causal chain inherited from the triggering envelope.
   * When present it is threaded into
   * {@link WorkflowExecutionContext.causal} by `runWorkflow`.
   */
  causal?: EventCausalContext;
}
