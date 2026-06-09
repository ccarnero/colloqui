export interface IAgentConfig {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly systemPrompt: string;
  readonly modelConfig: Record<string, unknown>;
  readonly tools: string[];
  readonly channels: string[];
  readonly status: "draft" | "published" | "archived";
}

export interface IAgentHierarchy {
  readonly agentId: string;
  readonly parentAgentId?: string;
  readonly childAgentIds: string[];
  readonly role: string;
}

export interface IAgentRole {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: string[];
  readonly constraints: string[];
}
