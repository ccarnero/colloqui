import { Inject, Injectable, NotFoundException } from "@nestjs/common";
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
import { PinoLoggerService } from "@yoizen/observability";
import type {
  IWorkflowDefinitionRow,
  IWorkflowExecutionRow,
} from "./workflows.repository";

/** Execution row exposed over HTTP (camelCase). */
export interface IWorkflowExecutionListItem {
  id: string;
  definitionId: string;
  tenantId: string;
  temporalWorkflowId: string;
  temporalRunId: string;
  request: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateWorkflowResult {
  id: string;
  name: string;
  application: string;
  tenantId: string;
  actions: unknown;
  createdAt: Date;
}

/** Parameters for creating a workflow definition row. */
interface ICreateWorkflowParams {
  readonly tenantId: string;
  readonly name: string;
  readonly application: string;
  readonly actions: WorkflowAction[];
}

export interface IExecuteWorkflowResult {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  runId: string;
}

export interface IExecutionStatusResult {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  status: string;
  result?: WorkflowExecutionContext;
  createdAt: Date;
}

@Injectable()
export class WorkflowsService {
  private readonly logger = new PinoLoggerService(WorkflowsService.name);

  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    private readonly repository: WorkflowsRepository,
  ) {}

  /**
   * Persists a workflow definition for the tenant.
   *
   * @param params - Definition name, application, and ordered actions.
   * @returns Created row metadata.
   */
  async createWorkflow(
    params: ICreateWorkflowParams,
  ): Promise<ICreateWorkflowResult> {
    const { tenantId, name, application, actions } = params;
    const id = nanoid();
    const row = await this.repository.createDefinition({
      id,
      tenantId,
      name,
      application,
      actions,
    });

    this.logger.log(
      `Created workflow definition ${row.id} (${name}) for tenant ${tenantId}`,
    );

    return this.toCreateResult(row);
  }

  /**
   * Loads a workflow definition by id or throws {@link NotFoundException}.
   *
   * @param id - Definition id.
   * @param tenantId - Tenant scope.
   */
  async getWorkflow(
    id: string,
    tenantId: string,
  ): Promise<ICreateWorkflowResult> {
    const row = await this.repository.findDefinitionById(id, tenantId);
    if (!row) {
      throw new NotFoundException("Workflow definition not found");
    }
    return this.toCreateResult(row);
  }

  /**
   * Lists all workflow definitions for the tenant.
   *
   * @param tenantId - Tenant scope.
   */
  async listWorkflows(tenantId: string): Promise<ICreateWorkflowResult[]> {
    const rows = await this.repository.findDefinitionsByTenant(tenantId);
    return rows.map((r) => this.toCreateResult(r));
  }

  /**
   * Soft-deletes a workflow definition.
   *
   * @param id - Definition id.
   * @param tenantId - Tenant scope.
   */
  async deleteWorkflow(id: string, tenantId: string): Promise<void> {
    const deleted = await this.repository.softDeleteDefinition(id, tenantId);
    if (!deleted) {
      throw new NotFoundException("Workflow definition not found");
    }
    this.logger.log(
      `Soft-deleted workflow definition ${id} for tenant ${tenantId}`,
    );
  }

  /**
   * Starts a Temporal workflow run for the definition with the given request payload.
   *
   * @param definitionId - Stored definition id.
   * @param tenantId - Tenant scope (search attribute).
   * @param request - Initial execution context / template input.
   */
  async executeWorkflow(
    definitionId: string,
    tenantId: string,
    request: Record<string, unknown>,
  ): Promise<IExecuteWorkflowResult> {
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

    const handle = await this.temporal.workflow.start("runWorkflow", {
      taskQueue: WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
      workflowId: temporalWorkflowId,
      args: [workflowDef],
      workflowExecutionTimeout: WORKFLOW_DEFAULT_TIMEOUT_MS,
      searchAttributes: {
        TenantId: [tenantId],
      },
    });

    const row = await this.repository.createExecution({
      id: executionId,
      definitionId,
      tenantId,
      temporalWorkflowId,
      temporalRunId: handle.firstExecutionRunId,
      request,
    });

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

  /**
   * Lists execution rows for a definition.
   *
   * @param definitionId - Parent definition id.
   * @param tenantId - Tenant scope.
   */
  async listExecutions(
    definitionId: string,
    tenantId: string,
  ): Promise<IWorkflowExecutionListItem[]> {
    const definition = await this.repository.findDefinitionById(
      definitionId,
      tenantId,
    );
    if (!definition) {
      throw new NotFoundException("Workflow definition not found");
    }

    const rows = await this.repository.findExecutionsByDefinition(
      definitionId,
      tenantId,
    );
    return rows.map((r) => this.mapExecutionRow(r));
  }

  /**
   * Resolves execution status from Temporal and syncs the DB when the status changes.
   *
   * @param definitionId - Expected parent definition id (validated against the row).
   * @param executionId - Execution row id.
   * @param tenantId - Tenant scope.
   */
  async getExecutionStatus(
    definitionId: string,
    executionId: string,
    tenantId: string,
  ): Promise<IExecutionStatusResult> {
    const execution = await this.repository.findExecutionById(
      executionId,
      tenantId,
    );
    if (!execution) {
      throw new NotFoundException("Workflow execution not found");
    }
    if (execution.definition_id !== definitionId) {
      throw new NotFoundException("Workflow execution not found");
    }

    const handle = this.temporal.workflow.getHandle(
      execution.temporal_workflow_id,
    );
    const describe = await handle.describe();
    const currentStatus = describe.status.name;

    if (currentStatus !== execution.status) {
      await this.repository.updateExecutionStatus(executionId, currentStatus);
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

  private mapExecutionRow(row: IWorkflowExecutionRow): IWorkflowExecutionListItem {
    return {
      id: row.id,
      definitionId: row.definition_id,
      tenantId: row.tenant_id,
      temporalWorkflowId: row.temporal_workflow_id,
      temporalRunId: row.temporal_run_id,
      request: row.request,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toCreateResult(row: IWorkflowDefinitionRow): ICreateWorkflowResult {
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
