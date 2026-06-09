export interface ICostEvent {
  readonly tenantId: string;
  readonly agentId: string;
  readonly executionId: string;
  readonly model: string;
  readonly provider: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly costUsd: number;
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
}
