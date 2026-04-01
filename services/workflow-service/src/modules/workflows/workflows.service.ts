import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Client } from "@temporalio/client";
import { nanoid } from "nanoid";
import {
  WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
  WORKFLOW_DEFAULT_TIMEOUT_MS,
} from "@yoizen/shared";
import type {
  WorkflowDefinition,
  WorkflowAction,
  WorkflowExecutionContext,
} from "@yoizen/shared";
import { TEMPORAL_CLIENT } from "../../providers/temporal.provider";
import { WorkflowsRepository } from "./workflows.repository";
import type {
  WorkflowDefinitionRow,
  WorkflowExecutionRow,
} from "./workflows.repository";

export interface ICreateWorkflowResult {
  id: string;
  name: string;
  application: string;
  tenantId: string;
  actions: unknown;
  createdAt: Date;
}

export interface ExecuteWorkflowResult {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  runId: string;
}

export interface ExecutionStatusResult {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  status: string;
  result?: WorkflowExecutionContext;
  createdAt: Date;
}

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    private readonly repository: WorkflowsRepository,
  ) {}

  async createWorkflow(
    tenantId: string,
    name: string,
    application: string,
    actions: WorkflowAction[],
  ): Promise<ICreateWorkflowResult> {
    const id = nanoid();
    const row = await this.repository.createDefinition(
      id,
      tenantId,
      name,
      application,
      actions,
    );

    this.logger.log(
      `Created workflow definition ${row.id} (${name}) for tenant ${tenantId}`,
    );

    return this.toCreateResult(row);
  }

  async getWorkflow(
    id: string,
    tenantId: string,
  ): Promise<ICreateWorkflowResult> {
    const row = await this.repository.findDefinitionById(
      id,
      tenantId,
    );
    if (!row) {
      throw new NotFoundException("Workflow definition not found");
    }
    return this.toCreateResult(row);
  }

  async listWorkflows(
    tenantId: string,
  ): Promise<ICreateWorkflowResult[]> {
    const rows =
      await this.repository.findDefinitionsByTenant(tenantId);
    return rows.map((r) => this.toCreateResult(r));
  }

  async deleteWorkflow(
    id: string,
    tenantId: string,
  ): Promise<void> {
    const deleted = await this.repository.softDeleteDefinition(
      id,
      tenantId,
    );
    if (!deleted) {
      throw new NotFoundException("Workflow definition not found");
    }
    this.logger.log(
      `Soft-deleted workflow definition ${id} for tenant ${tenantId}`,
    );
  }

  async executeWorkflow(
    definitionId: string,
    tenantId: string,
    request: Record<string, unknown>,
  ): Promise<ExecuteWorkflowResult> {
    const definition = await this.repository.findDefinitionById(
      definitionId,
      tenantId,
    );
    if (!definition) {
      throw new NotFoundException("Workflow definition not found");
    }

    const temporalWorkflowId = `${tenantId}:${definition.name}:${nanoid()}`;
    const executionId = nanoid();

    const workflowDef: WorkflowDefinition = {
      name: definition.name,
      tenant: tenantId,
      application: definition.application,
      request,
      actions: definition.actions as WorkflowAction[],
    };

    const handle = await this.temporal.workflow.start(
      "runWorkflow",
      {
        taskQueue: WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
        workflowId: temporalWorkflowId,
        args: [workflowDef],
        workflowExecutionTimeout: WORKFLOW_DEFAULT_TIMEOUT_MS,
        searchAttributes: {
          TenantId: [tenantId],
        },
      },
    );

    const row = await this.repository.createExecution(
      executionId,
      definitionId,
      tenantId,
      temporalWorkflowId,
      handle.firstExecutionRunId,
      request,
    );

    this.logger.log(
      `Started execution ${row.id} for definition ${definitionId} ` +
        `(temporal=${temporalWorkflowId}, runId=${handle.firstExecutionRunId})`,
    );

    return {
      executionId: row.id,
      definitionId,
      temporalWorkflowId,
      runId: handle.firstExecutionRunId,
    };
  }

  async listExecutions(
    definitionId: string,
    tenantId: string,
  ): Promise<WorkflowExecutionRow[]> {
    const definition = await this.repository.findDefinitionById(
      definitionId,
      tenantId,
    );
    if (!definition) {
      throw new NotFoundException("Workflow definition not found");
    }

    return this.repository.findExecutionsByDefinition(
      definitionId,
      tenantId,
    );
  }

  async getExecutionStatus(
    executionId: string,
    tenantId: string,
  ): Promise<ExecutionStatusResult> {
    const execution = await this.repository.findExecutionById(
      executionId,
      tenantId,
    );
    if (!execution) {
      throw new NotFoundException("Workflow execution not found");
    }

    const handle = this.temporal.workflow.getHandle(
      execution.temporal_workflow_id,
    );
    const describe = await handle.describe();
    const currentStatus = describe.status.name;

    if (currentStatus !== execution.status) {
      await this.repository.updateExecutionStatus(
        executionId,
        currentStatus,
      );
    }

    let result: WorkflowExecutionContext | undefined;
    if (currentStatus === "COMPLETED") {
      result = await handle.result();
    }

    return {
      executionId: execution.id,
      definitionId: execution.definition_id,
      temporalWorkflowId: execution.temporal_workflow_id,
      status: currentStatus,
      result,
      createdAt: execution.created_at,
    };
  }

  private toCreateResult(
    row: WorkflowDefinitionRow,
  ): ICreateWorkflowResult {
    return {
      id: row.id,
      name: row.name,
      application: row.application,
      tenantId: row.tenant_id,
      actions: row.actions,
      createdAt: row.created_at,
    };
  }
}
