import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Client } from '@temporalio/client';
import { nanoid } from 'nanoid';
import {
  WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
  WORKFLOW_DEFAULT_TIMEOUT_MS,
} from '@yoizen/shared';
import type {
  WorkflowDefinition,
  WorkflowAction,
  WorkflowExecutionContext,
} from '@yoizen/shared';
import { TEMPORAL_CLIENT } from '../../providers/temporal.provider';

export interface StartWorkflowResult {
  workflowId: string;
  runId: string;
}

export interface WorkflowStatusResult {
  workflowId: string;
  status: string;
  result?: WorkflowExecutionContext;
}

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
  ) {}

  async startWorkflow(
    name: string,
    application: string,
    tenantId: string,
    request: Record<string, unknown>,
    actions: WorkflowAction[],
  ): Promise<StartWorkflowResult> {
    const workflowId = `${tenantId}:${name}:${nanoid()}`;

    const definition: WorkflowDefinition = {
      name,
      tenant: tenantId,
      application,
      request,
      actions,
    };

    const handle = await this.temporal.workflow.start('runWorkflow', {
      taskQueue: WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
      workflowId,
      args: [definition],
      workflowExecutionTimeout: WORKFLOW_DEFAULT_TIMEOUT_MS,
      searchAttributes: {
        TenantId: [tenantId],
      },
    });

    this.logger.log(
      `Started workflow ${workflowId} (runId=${handle.firstExecutionRunId})`,
    );

    return { workflowId, runId: handle.firstExecutionRunId };
  }

  async getWorkflowStatus(
    workflowId: string,
    tenantId: string,
  ): Promise<WorkflowStatusResult> {
    if (!workflowId.startsWith(`${tenantId}:`)) {
      throw new NotFoundException('Workflow not found');
    }

    const handle = this.temporal.workflow.getHandle(workflowId);
    const describe = await handle.describe();

    const statusName = describe.status.name;
    let result: WorkflowExecutionContext | undefined;

    if (statusName === 'COMPLETED') {
      result = await handle.result();
    }

    return { workflowId, status: statusName, result };
  }

  async listWorkflows(
    tenantId: string,
  ): Promise<Array<{ workflowId: string; status: string; startTime: Date }>> {
    const results: Array<{
      workflowId: string;
      status: string;
      startTime: Date;
    }> = [];

    const workflows = this.temporal.workflow.list({
      query: `TenantId = '${tenantId}'`,
    });

    for await (const wf of workflows) {
      results.push({
        workflowId: wf.workflowId,
        status: wf.status.name,
        startTime: wf.startTime,
      });
    }

    return results;
  }
}
