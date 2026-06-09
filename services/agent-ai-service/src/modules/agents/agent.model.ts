export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly modelConfig: Record<string, unknown>;
  readonly tools: readonly unknown[];
  readonly enabledTools: readonly string[] | null;
  readonly enabledMcpServers: readonly string[] | null;
  readonly toolDescriptionOverrides: Record<string, string> | null;
  readonly skills: readonly unknown[];
  readonly rules: readonly unknown[];
  readonly channels: readonly unknown[];
  readonly knowledgeBaseIds: readonly string[];
}

export class AgentInstance implements Agent {
  readonly #enabledMcpServers: readonly string[] | null;

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly description: string,
    public readonly systemPrompt: string,
    public readonly modelConfig: Record<string, unknown>,
    public readonly tools: readonly unknown[] = [],
    public readonly enabledTools: readonly string[] | null = null,
    enabledMcpServers: readonly string[] | null = null,
    public readonly toolDescriptionOverrides: Record<string, string> | null = null,
    public readonly skills: readonly unknown[] = [],
    public readonly rules: readonly unknown[] = [],
    public readonly channels: readonly unknown[] = [],
    public readonly knowledgeBaseIds: readonly string[] = [],
  ) {
    this.#enabledMcpServers = enabledMcpServers;
  }

  get enabledMcpServers(): readonly string[] | null {
    return this.#enabledMcpServers;
  }
}
