import type { HttpTransport } from '../transport';
import type { StartWorkflowParams, StartWorkflowResult, WorkflowStatusResult } from '../types';

export class WorkflowsClient {
  constructor(private readonly transport: HttpTransport) {}

  async start(params: StartWorkflowParams): Promise<StartWorkflowResult> {
    return this.transport.post<StartWorkflowResult>('/workflows', params);
  }

  async list(): Promise<WorkflowStatusResult[]> {
    return this.transport.get<WorkflowStatusResult[]>('/workflows');
  }

  async getStatus(workflowId: string): Promise<WorkflowStatusResult> {
    return this.transport.get<WorkflowStatusResult>(`/workflows/${encodeURIComponent(workflowId)}`);
  }
}
