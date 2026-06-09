import type { VariableResolutionContext } from "@yoizen/shared";

export interface ChatContextMessage {
  sender: "customer" | "agent" | "bot";
  content: string;
  createdAt?: string;
}

export interface ChatRequest {
  agentId: string;
  message: string;
  conversationId?: string;
  sessionId?: string;
  chatId?: string;
  userId?: string;
  customerName?: string;
  channel?: string;
  context?: ChatContextMessage[];
  metadata?: Record<string, unknown>;
  variables?: VariableResolutionContext;
}

export interface ChatResponse {
  text: string;
  agentId: string;
  conversationId?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  toolCalls?: Array<{
    type: string;
    toolName: string;
    args: Record<string, unknown>;
  }>;
  toolResults?: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
    success?: boolean;
  }>;
  model?: string;
  provider?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface RuntimeState {
  systemPrompt: string;
  rules: readonly unknown[];
  memoryContext: string;
  conversationHistory: ChatMessage[];
  availableTools: readonly unknown[];
  availableSkills: readonly unknown[];
  userMessage: string;
  runtimeContext: Record<string, unknown>;
  renderedSystemPrompt?: string;
  skillInstructions?: string;
  activeSkillName?: string;
  resolvedTools?: Record<string, any>;
}
