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
  result?: YoizenClawExecutionResultPayload;
}
