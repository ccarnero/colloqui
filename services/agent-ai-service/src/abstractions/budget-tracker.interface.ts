import type { ICostEvent } from "./cost-event.interface";

export interface IBudgetTracker {
  getUsage(tenantId: string, agentId: string): Promise<IBudgetUsage>;
  canProceed(tenantId: string, agentId: string, estimatedCost: number): Promise<boolean>;
  recordCost(event: ICostEvent): Promise<boolean>;
}

export interface IBudgetUsage {
  readonly tenantId: string;
  readonly agentId: string;
  readonly period: string;
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly limitUsd: number;
  readonly remaining: number;
}
