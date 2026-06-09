export interface ITask {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly tenantId: string;
  readonly agentId: string;
  readonly createdAt: string;
}

export interface IOrchestratedTask extends ITask {
  readonly parentTaskId?: string;
  readonly childTaskIds: string[];
  readonly depth: number;
}
