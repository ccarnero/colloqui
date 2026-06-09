/**
 * Local re-exports and type aliases for the Temporal worker.
 *
 * Types from `@yoizen/shared` are re-exported so callers only need
 * one import path (`./workflow.types`). Only aliases that differ in
 * naming (e.g. `AgentChatRequest`) are defined here.
 */

// ── Re-exports from shared ──────────────────────────────────────────

export type {
  WorkflowAction,
  WorkflowDefinition,
  ConditionComparator,
  IConditionRule,
  IConditionalBranch,
  ConditionalAction,
  VariableResolutionContext,
  EventCausalContext,
  EndpointCallArgs,
  JsFunctionArgs,
  ServiceBusCallArgs,
  ServiceCallArgs,
  ChannelSendArgs,
  AgentCallArgs,
} from "@yoizen/shared";

import type {
  AgentCallArgs as SharedAgentCallArgs,
  WorkflowExecutionContext as SharedWorkflowExecutionContext,
} from "@yoizen/shared";

// ── Local aliases / extensions ──────────────────────────────────────

/**
 * Local WorkflowExecutionContext extends the shared one with `executionId`
 * which is set by `runWorkflow` at runtime.
 */
export interface WorkflowExecutionContext
  extends SharedWorkflowExecutionContext {
  executionId?: string;
}

/**
 * Agent execution request shape used by the worker activity.
 * Alias of `AgentCallArgs` renamed for clarity in the worker context
 * (the agent call activity calls the HTTP endpoint "chat").
 */
export type AgentChatRequest = SharedAgentCallArgs;

export interface HttpExecutionResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}