export type OrchestrationHookType =
  | "pre_execution"
  | "post_execution"
  | "pre_tool_call"
  | "post_tool_call"
  | "on_error"
  | "on_agent_switch";

export interface IOrchestrationHook {
  readonly type: OrchestrationHookType;
  readonly name: string;
  execute(context: IOrchestrationContext): Promise<IOrchestrationResult>;
}

export interface IOrchestrationContext {
  readonly tenantId: string;
  readonly agentId: string;
  readonly executionId: string;
  readonly data: Record<string, unknown>;
}

export interface IOrchestrationResult {
  readonly proceed: boolean;
  readonly modifiedData?: Record<string, unknown>;
  readonly error?: string;
}
