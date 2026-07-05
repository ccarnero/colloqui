import type { Paginated } from "../../core/pagination.js";
import { paginate, toOffsetPage, toSinglePage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  CreateWorkflowInput,
  ExecuteWorkflowInput,
  ExecuteWorkflowOptions,
  ExecuteWorkflowResult,
  ExecutionStatusResult,
  ListExecutionsParams,
  UpdateWorkflowInput,
  Workflow,
  WorkflowExecutionListItem,
  WorkflowExecutionsPage,
  WorkflowsSummary,
} from "./types.js";

export interface WorkflowsClientDeps {
  transport: Transport;
}

export interface WorkflowCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface WorkflowsClient {
  /** `POST /workflows` — create a workflow definition. */
  create(
    input: CreateWorkflowInput,
    opts?: WorkflowCallOptions
  ): Promise<Workflow>;
  /** `PUT /workflows/:id` — full-replace an existing workflow definition. */
  update(
    id: string,
    input: UpdateWorkflowInput,
    opts?: WorkflowCallOptions
  ): Promise<Workflow>;
  /**
   * `GET /workflows` — the API returns a bare array (no pagination
   * convention today, see `src/core/pagination.ts`), degraded to a single
   * page. `for await (const wf of client.workflows.list())`, or
   * `.page()` for the raw array + count.
   */
  list(): Paginated<Workflow>;
  /** `GET /workflows/:id`. */
  get(id: string, opts?: WorkflowCallOptions): Promise<Workflow>;
  /** `DELETE /workflows/:id` — soft-delete; resolves on 204. */
  remove(id: string, opts?: WorkflowCallOptions): Promise<void>;
  /** `POST /workflows/:id/execute` — starts a Temporal run; 202 Accepted. */
  execute(
    id: string,
    input: ExecuteWorkflowInput,
    opts?: ExecuteWorkflowOptions
  ): Promise<ExecuteWorkflowResult>;
  /**
   * `GET /workflows/:id/executions` — real `page`/`pageSize` + `{ items, total }`
   * pagination, adapted to the shared `limit`/`offset` convention via
   * `toOffsetPage`.
   */
  listExecutions(
    id: string,
    params?: ListExecutionsParams
  ): Paginated<WorkflowExecutionListItem>;
  /** `GET /workflows/:id/executions/:executionId`. */
  getExecution(
    id: string,
    executionId: string,
    opts?: WorkflowCallOptions
  ): Promise<ExecutionStatusResult>;
  /** `GET /workflows/executions/counts` — tenant-wide, grouped by definition id. */
  executionCounts(opts?: WorkflowCallOptions): Promise<Record<string, number>>;
  /**
   * `GET /workflows/executions?correlation_id=...` — tenant-wide trace lookup.
   * Bare array today, degraded to a single page like {@link list}.
   */
  executionsByCorrelation(
    correlationId: string
  ): Paginated<WorkflowExecutionListItem>;
  /**
   * `GET /workflows/summary` — tenant-wide aggregate stats (active/failing
   * definitions, 7d/24h execution counts, top definitions by execution
   * count). Verified live against the dev cluster 2026-07-05.
   */
  summary(opts?: WorkflowCallOptions): Promise<WorkflowsSummary>;
}

/**
 * Creates the `workflows` namespace client. Reference implementation for the
 * resource-client pattern (GROWTH-PLAN.md Phase 2) — see sdk/README.md
 * "Resource clients" for the write-up every later resource follows.
 */
export function createWorkflowsClient({
  transport,
}: WorkflowsClientDeps): WorkflowsClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  async function create(
    input: CreateWorkflowInput,
    opts: WorkflowCallOptions = {}
  ): Promise<Workflow> {
    const { body } = await transport.request<Workflow>({
      path: "/workflows",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function update(
    id: string,
    input: UpdateWorkflowInput,
    opts: WorkflowCallOptions = {}
  ): Promise<Workflow> {
    const { body } = await transport.request<Workflow>({
      path: `/workflows/${encodePath(id)}`,
      method: "PUT",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function list(): Paginated<Workflow> {
    return paginate<Workflow>(async () => {
      const { body } = await transport.request<Workflow[]>({
        path: "/workflows",
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function get(
    id: string,
    opts: WorkflowCallOptions = {}
  ): Promise<Workflow> {
    const { body } = await transport.request<Workflow>({
      path: `/workflows/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function remove(
    id: string,
    opts: WorkflowCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/workflows/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  async function execute(
    id: string,
    input: ExecuteWorkflowInput,
    opts: ExecuteWorkflowOptions = {}
  ): Promise<ExecuteWorkflowResult> {
    const { body } = await transport.request<ExecuteWorkflowResult>({
      path: `/workflows/${encodePath(id)}/execute`,
      method: "POST",
      body: input,
      idempotencyKey: opts.idempotencyKey,
    });
    return body;
  }

  function listExecutions(
    id: string,
    params: ListExecutionsParams = {}
  ): Paginated<WorkflowExecutionListItem> {
    return paginate<WorkflowExecutionListItem>(
      async ({ limit, offset }) => {
        const page = Math.floor(offset / limit) + 1;
        const query = new URLSearchParams({
          page: String(page),
          pageSize: String(limit),
        });
        if (params.sort) {
          query.set("sort", params.sort);
        }
        const { body } = await transport.request<WorkflowExecutionsPage>({
          path: `/workflows/${encodePath(id)}/executions?${query.toString()}`,
          method: "GET",
        });
        return toOffsetPage(body.items, body.total, offset);
      },
      { pageSize: params.pageSize, startOffset: params.startOffset }
    );
  }

  async function getExecution(
    id: string,
    executionId: string,
    opts: WorkflowCallOptions = {}
  ): Promise<ExecutionStatusResult> {
    const { body } = await transport.request<ExecutionStatusResult>({
      path: `/workflows/${encodePath(id)}/executions/${encodePath(executionId)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function executionCounts(
    opts: WorkflowCallOptions = {}
  ): Promise<Record<string, number>> {
    const { body } = await transport.request<Record<string, number>>({
      path: "/workflows/executions/counts",
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  function executionsByCorrelation(
    correlationId: string
  ): Paginated<WorkflowExecutionListItem> {
    return paginate<WorkflowExecutionListItem>(async () => {
      const query = new URLSearchParams({ correlation_id: correlationId });
      const { body } = await transport.request<WorkflowExecutionListItem[]>({
        path: `/workflows/executions?${query.toString()}`,
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function summary(
    opts: WorkflowCallOptions = {}
  ): Promise<WorkflowsSummary> {
    const { body } = await transport.request<WorkflowsSummary>({
      path: "/workflows/summary",
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  return {
    create,
    update,
    list,
    get,
    remove,
    execute,
    listExecutions,
    getExecution,
    executionCounts,
    executionsByCorrelation,
    summary,
  };
}
