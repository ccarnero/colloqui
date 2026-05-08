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
