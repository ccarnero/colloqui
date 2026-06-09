export interface IAgentPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  initialize(context: IPluginContext): Promise<void>;
  destroy(): Promise<void>;
}

export interface IPluginContext {
  readonly agentId: string;
  readonly tenantId: string;
  readonly config: Record<string, unknown>;
}
