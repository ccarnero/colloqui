import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowFailedError,
} from "@temporalio/client";
import {
  ActivityFailure,
  TemporalFailure,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/common";
import { PinoLoggerService } from "@yoizen/observability";
import type {
  EventCausalContext,
  WorkflowAction,
  WorkflowDefinition,
  WorkflowExecutionContext,
  WorkflowStatusValue,
  WorkflowTrigger,
} from "@yoizen/shared";
import {
  WORKFLOW_DEFAULT_TIMEOUT_MS,
  WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
  WORKFLOW_TASK_TIMEOUT_MS,
  WorkflowStatus,
} from "@yoizen/shared";
import { nanoid } from "nanoid";
import { TEMPORAL_CLIENT } from "../../providers/temporal.provider";
import type { IListExecutionsQuery } from "./dto/list-executions-query.dto";
import {
  EXECUTIONS_REPOSITORY,
  type IExecutionsRepository,
  type ITopDefinitionRow,
  type IWorkflowExecutionRow,
} from "./executions.repository.interface";
import { RegisteredServicesResolver } from "./registered-services.resolver";
import { augmentActionsWithSlug, collectServiceIds } from "./service-id-walker";
import { SystemVariablesProvider } from "./system-variables.provider";
import {
  type IWorkflowDefinitionRow,
  type IWorkflowsRepository,
  WORKFLOWS_REPOSITORY,
  WorkflowNotFoundError,
} from "./workflows.repository.interface";

/**
 * 409 response body when `executeWorkflow` is blocked because the target
 * definition's per-tenant `status` is `disabled` (`WorkflowStatus.DISABLED`,
 * `@yoizen/shared` workflow.interfaces.ts:308-316). The trigger consumer
 * pattern-matches on `code` to skip (ack) instead of nacking the message.
 */
export interface IWorkflowDisabledConflict {
  statusCode: 409;
  error: "Conflict";
  code: "WORKFLOW_DISABLED";
  message: string;
  workflowId: string;
  tenantId: string;
}

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
  variables: unknown;
  status: WorkflowStatusValue;
  createdAt: Date;
}

interface ICreateWorkflowParams {
  readonly tenantId: string;
  readonly name: string;
  readonly application: string;
  readonly actions: WorkflowAction[];
  readonly trigger?: WorkflowTrigger;
  readonly variables?: Record<string, unknown>;
}

interface IUpdateWorkflowParams {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly application: string;
  readonly actions: WorkflowAction[];
  readonly trigger?: WorkflowTrigger;
  readonly variables?: Record<string, unknown>;
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
   * (DOCS/messaging/envelope.md §6).
   */
  readonly causal?: EventCausalContext;
  /**
   * The original HTTP `x-request-id` from the api-gateway. Used only
   * for log correlation — not stored in DB or propagated to activities.
   */
  readonly requestId?: string | null;
  /**
   * Optional agent call timeout in milliseconds. When set, overrides
   * the default `AGENT_CALL_TIMEOUT_MS` env var for this execution.
   */
  readonly agentTimeoutMs?: number;
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

/** One failed termination attempt inside {@link ITerminateExecutionsResult}. */
export interface ITerminateExecutionFailure {
  workflowId: string;
  runId: string;
  error: string;
}

/**
 * Result of {@link WorkflowsService.terminateRunningExecutions}: how many
 * running Temporal executions were terminated, and which ones failed
 * (a failure on one execution never stops the rest).
 */
export interface ITerminateExecutionsResult {
  terminated: number;
  failed: ITerminateExecutionFailure[];
}

/**
 * Result of {@link WorkflowsService.updateWorkflowStatus}. `terminated` is
 * only populated when the status transitions to `WorkflowStatus.DISABLED`
 * (see `@yoizen/shared` workflow.interfaces.ts:308-316); enabling a
 * definition never touches running executions.
 */
export interface IUpdateWorkflowStatusResult {
  id: string;
  name: string;
  status: WorkflowStatusValue;
  terminated?: number;
}

export interface IWorkflowsSummary {
  readonly activeDefinitions: number;
  readonly definitionsFailingNow: number;
  readonly definitionsWithFailuresLast7d: number;
  readonly executionsCompletedLast7d: number;
  readonly executionsFailedLast7d: number;
  readonly executionsRunningLast7d: number;
  readonly executionsCompletedLast24h: number;
  readonly topByExecutionCountLast7d: readonly ITopDefinitionRow[];
}

const FAIL_STATUSES = ["FAILED", "TIMED_OUT", "CANCELLED", "TERMINATED"];

@Injectable()
export class WorkflowsService {
  private readonly logger = new PinoLoggerService(WorkflowsService.name);

  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    @Inject(WORKFLOWS_REPOSITORY)
    private readonly definitions: IWorkflowsRepository,
    @Inject(EXECUTIONS_REPOSITORY)
    private readonly executions: IExecutionsRepository,
    private readonly servicesResolver: RegisteredServicesResolver,
    private readonly systemVarsProvider: SystemVariablesProvider,
  ) {}

  /**
   * Persists a workflow definition for the tenant.
   *
   * @param params - Definition name, application, and ordered actions.
   * @returns Created row metadata.
   */
  async createWorkflow(
    params: ICreateWorkflowParams
  ): Promise<ICreateWorkflowResult> {
    const { tenantId, name, application, actions, trigger, variables } = params;
    const id = nanoid();
    const row = await this.definitions.createDefinition({
      id,
      tenantId,
      name,
      application,
      actions,
      trigger,
      variables,
    });

    this.logger.log(
      `Created workflow definition ${row.id} (${name}) for tenant ${tenantId}`
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
    params: IUpdateWorkflowParams
  ): Promise<ICreateWorkflowResult> {
    const row = await this.definitions.updateDefinition(params);
    if (!row) {
      throw new NotFoundException("Workflow definition not found");
    }

    this.logger.log(
      `Updated workflow definition ${row.id} for tenant ${params.tenantId}`
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
    tenantId: string
  ): Promise<ICreateWorkflowResult> {
    const row = await this.definitions.findDefinitionById(id, tenantId);
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
    const rows = await this.definitions.findDefinitionsByTenant(tenantId);
    return rows.map((r) => this.toCreateResult(r, tenantId));
  }

  /**
   * Soft-deletes a workflow definition.
   *
   * @param id - Definition id.
   * @param tenantId - Tenant scope.
   */
  async deleteWorkflow(id: string, tenantId: string): Promise<void> {
    const deleted = await this.definitions.softDeleteDefinition(id, tenantId);
    if (!deleted) {
      throw new NotFoundException("Workflow definition not found");
    }
    this.logger.log(
      `Soft-deleted workflow definition ${id} for tenant ${tenantId}`
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
    options: IExecuteWorkflowOptions = {}
  ): Promise<IExecuteWorkflowResult> {
    const definition = await this.definitions.findDefinitionById(
      definitionId,
      tenantId
    );
    if (!definition) {
      throw new NotFoundException("Workflow definition not found");
    }

    // Rule: per-tenant WorkflowStatus.DISABLED blocks new executions at the
    // choke point shared by the HTTP execute endpoint and the trigger
    // consumer (workflow.interfaces.ts:308-316).
    if (definition.status === WorkflowStatus.DISABLED) {
      this.logger.warn(
        `Blocked execution: workflow ${definitionId} is disabled for tenant ${tenantId}`
      );
      const body: IWorkflowDisabledConflict = {
        statusCode: 409,
        error: "Conflict",
        code: "WORKFLOW_DISABLED",
        message: `Workflow '${definitionId}' is disabled for tenant '${tenantId}' and cannot be executed`,
        workflowId: definitionId,
        tenantId,
      };
      throw new ConflictException(body);
    }

    const isIdempotent = options.idempotencyKey !== undefined;
    const temporalWorkflowId = isIdempotent
      ? `${tenantId}:${definition.name}:${options.idempotencyKey!}`
      : `${tenantId}:${definition.name}:${nanoid()}`;
    const executionId = nanoid();

    const rawActions = definition.actions as WorkflowAction[];
    const actions = await this.preResolveServiceSlugs(rawActions, tenantId);

    const workflowDef: WorkflowDefinition = {
      name: definition.name,
      tenant: tenantId,
      application: definition.application,
      request,
      actions,
      ...(definition.variables
        ? { variables: definition.variables as Record<string, unknown> }
        : {}),
      ...(options.causal && { causal: options.causal }),
      ...(options.agentTimeoutMs !== undefined && {
        agentTimeoutMs: options.agentTimeoutMs,
      }),
    };

    // Load system variables for the tenant (cached, 5-min TTL).
    // Errors are non-fatal: the workflow runs with empty system vars.
    let systemVars: Record<string, unknown> = {};
    try {
      systemVars = await this.systemVarsProvider.loadForTenant(tenantId);
    } catch {
      this.logger.log(
        `Failed to load system variables for tenant ${tenantId}, continuing with empty system vars`
      );
    }

    try {
      const handle = await this.temporal.workflow.start("runWorkflow", {
        taskQueue: WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
        workflowId: temporalWorkflowId,
        args: [workflowDef, executionId, systemVars],
        workflowExecutionTimeout: WORKFLOW_DEFAULT_TIMEOUT_MS,
        workflowTaskTimeout: WORKFLOW_TASK_TIMEOUT_MS,
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

      const row = await this.executions.createExecution({
        id: executionId,
        definitionId,
        tenantId,
        temporalWorkflowId,
        temporalRunId: handle.firstExecutionRunId,
        correlationId: options.causal?.correlation_id ?? null,
        request,
      });

      this.logger.log(
        `Started execution ${row.id} for definition ${definitionId} ` +
          `(temporal=${temporalWorkflowId}, runId=${handle.firstExecutionRunId})` +
          (options.requestId ? `, requestId=${options.requestId}` : "")
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
          `Duplicate trigger ignored: workflow ${temporalWorkflowId} already started`
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
   * Terminates every currently running Temporal execution for the given
   * tenant + definition name. Used when a tenant admin disables a workflow
   * (`WorkflowStatus.DISABLED`, `@yoizen/shared` workflow.interfaces.ts:308-316)
   * so already-running instances stop instead of finishing on their own.
   *
   * Workflow ids are minted as `${tenantId}:${definition.name}:${...}`
   * (see {@link executeWorkflow}), so executions are matched by that prefix
   * after narrowing the Temporal visibility query to the tenant's running
   * executions via the `TenantId` search attribute.
   *
   * @param tenantId - Tenant scope (search attribute).
   * @param definitionName - Workflow definition name (id prefix segment).
   * @returns Count of terminated executions plus any per-execution failures.
   */
  async terminateRunningExecutions(
    tenantId: string,
    definitionName: string
  ): Promise<ITerminateExecutionsResult> {
    const idPrefix = `${tenantId}:${definitionName}:`;
    const result: ITerminateExecutionsResult = { terminated: 0, failed: [] };

    const executions = this.temporal.workflow.list({
      query: `TenantId='${tenantId}' AND ExecutionStatus='Running'`,
    });

    for await (const info of executions) {
      if (!info.workflowId.startsWith(idPrefix)) {
        continue;
      }

      try {
        const handle = this.temporal.workflow.getHandle(
          info.workflowId,
          info.runId
        );
        await handle.terminate("workflow disabled by tenant admin");
        result.terminated++;
        this.logger.log(
          `Terminated running execution for tenant ${tenantId}: ` +
            `workflowId=${info.workflowId}, runId=${info.runId}`
        );
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        result.failed.push({
          workflowId: info.workflowId,
          runId: info.runId,
          error,
        });
        this.logger.error(
          `Failed to terminate running execution for tenant ${tenantId}: ` +
            `workflowId=${info.workflowId}, runId=${info.runId}, error=${error}`
        );
      }
    }

    this.logger.log(
      `Termination sweep for tenant ${tenantId}, definition ${definitionName}: ` +
        `terminated=${result.terminated}, failed=${result.failed.length}`
    );

    return result;
  }

  /**
   * Sets the per-tenant enable/disable toggle on a workflow definition
   * (`WorkflowStatus.ENABLED` / `WorkflowStatus.DISABLED`, `@yoizen/shared`
   * workflow.interfaces.ts:308-316). Idempotent in both directions.
   *
   * Disabling first persists the toggle, then terminates every currently
   * running Temporal execution for the definition so already-started runs
   * stop instead of finishing on their own (see
   * {@link terminateRunningExecutions}). Enabling only flips the toggle —
   * it never starts or touches executions.
   *
   * @param tenantId - Tenant scope.
   * @param id - Definition id.
   * @param status - Target status.
   * @throws {NotFoundException} When no active definition matches (id, tenantId).
   */
  async updateWorkflowStatus(
    tenantId: string,
    id: string,
    status: WorkflowStatusValue
  ): Promise<IUpdateWorkflowStatusResult> {
    let row: IWorkflowDefinitionRow;
    try {
      row = await this.definitions.setStatus(tenantId, id, status);
    } catch (err: unknown) {
      if (err instanceof WorkflowNotFoundError) {
        throw new NotFoundException("Workflow definition not found");
      }
      throw err;
    }

    this.logger.log(
      `Workflow definition ${row.id} (${row.name}) status set to '${status}' for tenant ${tenantId}`
    );

    if (status === WorkflowStatus.DISABLED) {
      const { terminated, failed } = await this.terminateRunningExecutions(
        tenantId,
        row.name
      );
      if (failed.length > 0) {
        this.logger.warn(
          `Disabling workflow ${row.id} (${row.name}) for tenant ${tenantId} left ` +
            `${failed.length} running execution(s) unterminated`
        );
      }
      return { id: row.id, name: row.name, status: row.status, terminated };
    }

    return { id: row.id, name: row.name, status: row.status };
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
    query: IListExecutionsQuery
  ): Promise<IWorkflowExecutionsPage> {
    const definition = await this.definitions.findDefinitionById(
      definitionId,
      tenantId
    );
    if (!definition) {
      throw new NotFoundException("Workflow definition not found");
    }

    const { page, pageSize, sort } = query;
    const offset = (page - 1) * pageSize;

    // Issue both queries in parallel against the same per-tenant pool
    // to keep total latency at max(rows, total) instead of rows + total.
    const [rows, total] = await Promise.all([
      this.executions.findExecutionsByDefinition({
        definitionId,
        tenantId,
        limit: pageSize,
        offset,
        sort,
      }),
      this.executions.countExecutionsByDefinition(definitionId, tenantId),
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
    tenantId: string
  ): Promise<Record<string, number>> {
    const rows =
      await this.executions.countExecutionsGroupedByDefinition(tenantId);
    const counts: Record<string, number> = {};
    for (let i = 0, len = rows.length; i < len; i++) {
      const row = rows[i]!;
      counts[row.definition_id] = row.count;
    }
    return counts;
  }

  /**
   * Tenant-wide executions for one correlation_id (Message trace lookup).
   * Returns the run records (incl. `temporalWorkflowId`) so the trace UI can
   * render a workflow node and deep-link into Temporal.
   */
  async findExecutionsByCorrelation(
    tenantId: string,
    correlationId: string
  ): Promise<IWorkflowExecutionListItem[]> {
    if (!correlationId) {
      return [];
    }
    const rows = await this.executions.findExecutionsByCorrelation(
      correlationId,
      tenantId
    );
    return rows.map((row) => this.mapExecutionRow(row, tenantId));
  }

  /**
   * 8-way parallel summary for the workflows dashboard card.
   * All queries run against the per-tenant DB concurrently so total
   * latency equals the slowest single query.
   */
  async getWorkflowsSummary(tenantId: string): Promise<IWorkflowsSummary> {
    const now = new Date();
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1_000);

    const [
      activeDefinitions,
      definitionsFailingNow,
      definitionsWithFailuresLast7d,
      executionsCompletedLast7d,
      executionsFailedLast7d,
      executionsRunningLast7d,
      executionsCompletedLast24h,
      topByExecutionCountLast7d,
    ] = await Promise.all([
      this.definitions.countActiveDefinitions(tenantId),
      this.executions.countFailingByLastRun(tenantId),
      this.executions.countFailingByWindow7d(tenantId, since7d),
      this.executions.countExecutionsByStatusSince(
        tenantId,
        ["COMPLETED"],
        since7d
      ),
      this.executions.countExecutionsByStatusSince(
        tenantId,
        FAIL_STATUSES,
        since7d
      ),
      this.executions.countExecutionsByStatusSince(
        tenantId,
        ["RUNNING"],
        since7d
      ),
      this.executions.countExecutionsByStatusSince(
        tenantId,
        ["COMPLETED"],
        since24h
      ),
      this.executions.topDefinitionsByExecutionCount(tenantId, since7d, 5),
    ]);

    return {
      activeDefinitions,
      definitionsFailingNow,
      definitionsWithFailuresLast7d,
      executionsCompletedLast7d,
      executionsFailedLast7d,
      executionsRunningLast7d,
      executionsCompletedLast24h,
      topByExecutionCountLast7d,
    };
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
    tenantId: string
  ): Promise<IExecutionStatusResult> {
    const execution = await this.executions.findExecutionById(
      executionId,
      tenantId
    );
    if (!execution) {
      throw new NotFoundException("Workflow execution not found");
    }
    if (execution.definition_id !== definitionId) {
      throw new NotFoundException("Workflow execution not found");
    }

    const handle = this.temporal.workflow.getHandle(
      execution.temporal_workflow_id
    );
    const describe = await handle.describe();
    const currentStatus = describe.status.name;

    if (currentStatus !== execution.status) {
      await this.executions.updateExecutionStatus(
        executionId,
        tenantId,
        currentStatus
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

  /**
   * Walks every `serviceCall` action in the definition (including nested
   * `branch` arms), resolves each unique `serviceId` (UUID) to the
   * `registered_services.name` (slug) via {@link RegisteredServicesResolver},
   * and returns a new actions array with `args.serviceSlug` populated.
   */
  private async preResolveServiceSlugs(
    actions: WorkflowAction[],
    tenantId: string
  ): Promise<WorkflowAction[]> {
    const ids = collectServiceIds(actions);
    if (ids.size === 0) {
      return actions;
    }

    const slugMap = await this.servicesResolver.resolveSlugs(tenantId, ids);
    if (slugMap.size === 0) {
      return actions;
    }

    return augmentActionsWithSlug(actions, slugMap);
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
    tenantId: string
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
    tenantId: string
  ): ICreateWorkflowResult {
    return {
      id: row.id,
      name: row.name,
      application: row.application,
      tenantId,
      actions: row.actions,
      trigger: row.trigger,
      variables: row.variables,
      status: row.status,
      createdAt: row.created_at,
    };
  }
}
