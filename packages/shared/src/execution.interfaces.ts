export type YoizenClawExecutionType = "chat";

export type YoizenClawExecutionState =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface YoizenClawExecutionContextEntry {
  sender: "customer" | "agent";
  content: string;
}

export interface YoizenClawChatExecutionInput {
  agentId: string;
  message: string;
  conversationId?: string;
  customerName?: string;
  userId?: string;
  channel?: string;
  context?: YoizenClawExecutionContextEntry[];
  variables?: import("./variable.interfaces").VariableResolutionContext;
  /**
   * Runtime token streaming mode (DOCS/architecture/runtime-streaming.md).
   * When true, `agent-ai-service` publishes token deltas to the ephemeral
   * `rt.<tenant>.exec.<executionId>.token` subject instead of (only)
   * returning a buffered reply. Same execution pipeline, same subject for
   * submission — streaming is a mode, not a second way to run an agent.
   */
  stream?: boolean;
}

export interface YoizenClawExecutionRequest {
  executionId: string;
  type: YoizenClawExecutionType;
  tenantId: string;
  requestedAt: string;
  requestedBy?: string;
  input: YoizenClawChatExecutionInput;
  correlationId?: string;
  causationId?: string;
  depth?: number;
}

export interface YoizenClawExecutionSubmitted {
  executionId: string;
  status: "accepted";
}

export interface YoizenClawExecutionResultPayload {
  reply?: string;
  tool_calls?: unknown[];
  errorCode?: string;
  errorMessage?: string;
}

export interface YoizenClawExecutionStatus {
  executionId: string;
  tenantId: string;
  type: YoizenClawExecutionType;
  state: YoizenClawExecutionState;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  requestedBy?: string;
  agentId: string;
  correlationId?: string;
  causationId?: string;
  /**
   * Bus envelope id of the `execution_completed` event that carried this
   * terminal status. Threaded by ai-agent-gateway's result projector so
   * workflow-service can cite the agent execution as `causation_id` in
   * subsequent publications (correlation-chain fix 3). Absent on legacy
   * statuses and non-completed states.
   */
  completedEventId?: string;
  /** Causal depth (`transport.depth`) of that `execution_completed` event. */
  completedEventDepth?: number;
  result?: YoizenClawExecutionResultPayload;
}
