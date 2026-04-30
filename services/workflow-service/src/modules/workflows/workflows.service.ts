import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowFailedError,
  type Client,
} from "@temporalio/client";
import {
  ActivityFailure,
  TemporalFailure,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/common";
import { nanoid } from "nanoid";
import {
  WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
  WORKFLOW_DEFAULT_TIMEOUT_MS,
} from "@yoizen/shared";
import type {
  EventCausalContext,
  WorkflowDefinition,
  WorkflowAction,
  WorkflowTrigger,
  WorkflowExecutionContext,
} from "@yoizen/shared";
import { TEMPORAL_CLIENT } from "../../providers/temporal.provider";
import { WorkflowsRepository } from "./workflows.repository";
import { PinoLoggerService } from "@yoizen/observability";
import type {
  IWorkflowDefinitionRow,
  IWorkflowExecutionRow,
} from "./workflows.repository";
import type { IListExecutionsQuery } from "./dto/list-executions-query.dto";

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

/** Paginated list response for `GET /workflows/:id/executions`. */
export interface IWorkflowExecutionsPage {
  items: IWorkflowExecutionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ICreateWorkflowResult {
  id: string;
  name: string;
  application: string;
  tenantId: string;
  actions: unknown;
  trigger: unknown;
  createdAt: Date;
}

interface ICreateWorkflowParams {
  readonly tenantId: string;
  readonly name: string;
  readonly application: string;
  readonly actions: WorkflowAction[];
  readonly trigger?: WorkflowTrigger;
}

interface IUpdateWorkflowParams {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly application: string;
  readonly actions: WorkflowAction[];
  readonly trigger?: WorkflowTrigger;
}

export interface IExecuteWorkflowResult {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  runId: string;
  /**
   * `true` when this call did NOT start a new Temporal workflow because
   * one with the same deterministic id already existed (redelivery or
   * cross-pod race). Callers should treat it as an idempotent ack.
   */
  alreadyStarted?: boolean;
}

/**
 * Optional inputs for {@link WorkflowsService.executeWorkflow} that
 * make a trigger source idempotent. When `idempotencyKey` is provided
 * the Temporal workflowId becomes deterministic
 * (`<tenant>:<name>:<idempotencyKey>`) and duplicate starts are
 * rejected by Temporal itself.
 */
export interface IExecuteWorkflowOptions {
  /**
   * Stable id derived from the triggering message (typically the
   * envelope `idempotencykey` scoped with the workflow definition id).
   */
  readonly idempotencyKey?: string;
  /**
   * Causal-chain context inherited from the triggering envelope.
   * When present, publishing activities (e.g. `channelSend`) will set
   * `causation_id = causal.causation_id`, copy `correlation_id`, and
   * increment `transport.depth`, keeping the bus chain traceable
   * (wdocs-02 §6).
   */
  readonly causal?: EventCausalContext;
}

export interface IWorkflowFailureInfo {
  message: string;
  type: string;
  activityName?: string;
  cause?: string;
}

export interface IExecutionStatusResult {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  status: string;
  result?: WorkflowExecutionContext;
  failure?: IWorkflowFailureInfo;
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
    const { tenantId, name, application, actions, trigger } = params;
    const id = nanoid();
    const row = await this.repository.createDefinition({
      id,
      tenantId,
      name,
      application,
      actions,
      trigger,
    });

    this.logger.log(
      `Created workflow definition ${row.id} (${name}) for tenant ${tenantId}`,
    );

    return this.toCreateResult(row, tenantId);
  }

  /**
   * Updates an existing workflow definition.
   *
   * @param params - Definition id, tenant, and updated fields.
   * @returns Updated row metadata.
   */
  async updateWorkflow(
    params: IUpdateWorkflowParams,
  ): Promise<ICreateWorkflowResult> {
    const row = await this.repository.updateDefinition(params);
    if (!row) {
      throw new NotFoundException("Workflow definition not found");
    }

    this.logger.log(
      `Updated workflow definition ${row.id} for tenant ${params.tenantId}`,
    );

    return this.toCreateResult(row, params.tenantId);
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
    return this.toCreateResult(row, tenantId);
  }

  /**
   * Lists all workflow definitions for the tenant.
   *
   * @param tenantId - Tenant scope.
   */
  async listWorkflows(tenantId: string): Promise<ICreateWorkflowResult[]> {
    const rows = await this.repository.findDefinitionsByTenant(tenantId);
    return rows.map((r) => this.toCreateResult(r, tenantId));
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
    options: IExecuteWorkflowOptions = {},
  ): Promise<IExecuteWorkflowResult> {
    const definition = await this.repository.findDefinitionById(
      definitionId,
      tenantId,
    );
    if (!definition) {
      throw new NotFoundException("Workflow definition not found");
    }

    const isIdempotent = options.idempotencyKey !== undefined;
    const temporalWorkflowId = isIdempotent
      ? `${tenantId}:${definition.name}:${options.idempotencyKey!}`
      : `${tenantId}:${definition.name}:${nanoid()}`;
    const executionId = nanoid();

    const workflowDef: WorkflowDefinition = {
      name: definition.name,
      tenant: tenantId,
      application: definition.application,
      request,
      actions: definition.actions as WorkflowAction[],
      ...(options.causal && { causal: options.causal }),
    };

    try {
      const handle = await this.temporal.workflow.start("runWorkflow", {
        taskQueue: WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
        workflowId: temporalWorkflowId,
        args: [workflowDef, executionId],
        workflowExecutionTimeout: WORKFLOW_DEFAULT_TIMEOUT_MS,
        ...(isIdempotent
          ? {
              workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
              workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
            }
          : {}),
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
    } catch (err: unknown) {
      if (isIdempotent && err instanceof WorkflowExecutionAlreadyStartedError) {
        this.logger.log(
          `Duplicate trigger ignored: workflow ${temporalWorkflowId} already started`,
        );
        return {
          executionId,
          definitionId,
          temporalWorkflowId,
          runId: "",
          alreadyStarted: true,
        };
      }
      throw err;
    }
  }

  /**
   * Lists execution rows for a definition with server-side pagination
   * and `created_at` sort. Backed by the composite index
   * `idx_workflow_executions_definition_created_at` for O(log n + k)
   * page reads, where k = `query.pageSize`.
   *
   * @param definitionId - Parent definition id.
   * @param tenantId - Tenant scope.
   * @param query - Validated pagination + sort options.
   */
  async listExecutions(
    definitionId: string,
    tenantId: string,
    query: IListExecutionsQuery,
  ): Promise<IWorkflowExecutionsPage> {
    const definition = await this.repository.findDefinitionById(
      definitionId,
      tenantId,
    );
    if (!definition) {
      throw new NotFoundException("Workflow definition not found");
    }

    const { page, pageSize, sort } = query;
    const offset = (page - 1) * pageSize;

    // Issue both queries in parallel against the same per-tenant pool
    // to keep total latency at max(rows, total) instead of rows + total.
    const [rows, total] = await Promise.all([
      this.repository.findExecutionsByDefinition({
        definitionId,
        tenantId,
        limit: pageSize,
        offset,
        sort,
      }),
      this.repository.countExecutionsByDefinition(definitionId, tenantId),
    ]);

    return {
      items: rows.map((r) => this.mapExecutionRow(r, tenantId)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Tenant-wide executions count grouped by definition. Returns a
   * plain `Record<string, number>` so the wire format is JSON-friendly;
   * the caller (admin-console) folds it into a `Map<string, number>`
   * for O(1) per-card lookups.
   */
  async getExecutionCountsByTenant(
    tenantId: string,
  ): Promise<Record<string, number>> {
    const rows = await this.repository.countExecutionsGroupedByDefinition(
      tenantId,
    );
    const counts: Record<string, number> = {};
    for (let i = 0, len = rows.length; i < len; i++) {
      const row = rows[i]!;
      counts[row.definition_id] = row.count;
    }
    return counts;
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
      await this.repository.updateExecutionStatus(
        executionId,
        tenantId,
        currentStatus,
      );
    }

    let result: WorkflowExecutionContext | undefined;
    let failure: IWorkflowFailureInfo | undefined;

    if (currentStatus === "COMPLETED") {
      result = await handle.result();
    } else if (currentStatus === "FAILED") {
      try {
        await handle.result();
      } catch (err) {
        if (err instanceof WorkflowFailedError) {
          failure = this.extractFailureInfo(err);
        } else {
          failure = {
            message: err instanceof Error ? err.message : String(err),
            type: "Unknown",
          };
        }
      }
    }

    return {
      executionId: execution.id,
      definitionId: execution.definition_id,
      temporalWorkflowId: execution.temporal_workflow_id,
      status: currentStatus,
      result,
      failure,
      createdAt: execution.created_at,
    };
  }

  private extractFailureInfo(err: WorkflowFailedError): IWorkflowFailureInfo {
    const rootCause = err.cause;
    if (!rootCause) {
      return { message: err.message, type: "WorkflowFailedError" };
    }

    const info: IWorkflowFailureInfo = {
      message: rootCause.message,
      type: rootCause.constructor.name,
    };

    if (rootCause instanceof ActivityFailure) {
      info.activityName = rootCause.activityType;
    }

    let nested: unknown = rootCause.cause;
    while (nested instanceof TemporalFailure && nested.cause) {
      nested = nested.cause;
    }
    if (nested && nested !== rootCause && nested instanceof Error) {
      info.cause = nested.message;
    }

    return info;
  }

  private mapExecutionRow(
    row: IWorkflowExecutionRow,
    tenantId: string,
  ): IWorkflowExecutionListItem {
    return {
      id: row.id,
      definitionId: row.definition_id,
      tenantId,
      temporalWorkflowId: row.temporal_workflow_id,
      temporalRunId: row.temporal_run_id,
      request: row.request,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toCreateResult(
    row: IWorkflowDefinitionRow,
    tenantId: string,
  ): ICreateWorkflowResult {
    return {
      id: row.id,
      name: row.name,
      application: row.application,
      tenantId,
      actions: row.actions,
      trigger: row.trigger,
      createdAt: row.created_at,
    };
  }
}
