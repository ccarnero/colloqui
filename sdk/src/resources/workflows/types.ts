/**
 * Request/response types for the `workflows` resource, hand-typed against the
 * REAL gateway + downstream shapes (verified 2026-07-04, see
 * sdk/GROWTH-PLAN.md Phase 2):
 *
 * - `services/api-gateway/src/modules/workflows/workflows.controller.ts` proxies
 *   `POST/PUT /workflows[/:id]` bodies AS-IS to workflow-service (raw passthrough,
 *   no gateway-side DTO validation — see the controller's own comment on why).
 * - `services/workflow-service/src/modules/workflows/workflows.controller.ts` +
 *   `dto/create-workflow.dto.ts` / `dto/update-workflow.dto.ts` /
 *   `dto/list-executions-query.dto.ts` define the real validated shape.
 * - `WorkflowAction` / `WorkflowTrigger` are owned by the internal `@yoizen/shared`
 *   package (a discriminated union of 8 activity kinds). The SDK is a standalone
 *   published package and does not depend on internal workspace packages, so
 *   these are intentionally typed loosely here (`name`/`activity` + an open
 *   index signature) rather than mirroring the full union. Tighten this once
 *   OpenAPI codegen (GROWTH-PLAN.md P0.2) is in place.
 *
 * `GET /workflows/summary` — proxied by the gateway's `WorkflowsController`
 * (`@Get("summary")`, declared before `@Get(":id")` so Nest doesn't match
 * `summary` as a workflow id) to `workflow-service`'s
 * `getWorkflowsSummary()` (`IWorkflowsSummary`). Verified live against the
 * dev cluster 2026-07-05 (200 with real aggregate data) — see `summary()`.
 */

/** Loosely-typed workflow action. See the file header for why this isn't a full union. */
export interface WorkflowAction {
  name: string;
  activity: string;
  [key: string]: unknown;
}

/**
 * Arguments for an `mcpCall` action (mcp-connections.md §5). An MCP call
 * targets a registered MCP server (`serverId`) and one of the tools it
 * exposes (`toolName`), passing `params` through to the tool. Tools are
 * discovered live from the server's own `tools/list` (see
 * `mcpServers.listTools(id)`), never defined inline — so there is no
 * server-less / ad-hoc mode analogous to an endpoint call's raw URL.
 */
export interface McpCallArgs {
  serverId: string;
  toolName: string;
  params?: Record<string, unknown>;
}

/**
 * Strongly-typed helper for constructing an `mcpCall` {@link WorkflowAction}.
 * The base `WorkflowAction` stays intentionally loose (see the file header);
 * this narrower shape is offered for callers that want compile-time checking
 * when building an MCP step. Assignable to `WorkflowAction`.
 */
export interface McpCallAction {
  name: string;
  activity: "mcpCall";
  args: McpCallArgs;
}

/** Loosely-typed workflow trigger (today the only variant is `message_received`). */
export interface WorkflowTrigger {
  type: string;
  mode?: "exclusive" | "shared";
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CreateWorkflowInput {
  name: string;
  application: string;
  actions: WorkflowAction[];
  variables?: Record<string, unknown>;
  trigger?: WorkflowTrigger;
}

/** `PUT /workflows/:id` takes the same full-replace shape as create. */
export type UpdateWorkflowInput = CreateWorkflowInput;

/** Response shape for create/update/get/list (`ICreateWorkflowResult` in workflow-service). */
export interface Workflow {
  id: string;
  name: string;
  application: string;
  tenantId: string;
  actions: WorkflowAction[];
  trigger?: WorkflowTrigger;
  variables?: Record<string, unknown>;
  /** ISO-8601 timestamp (serialized `Date`). */
  createdAt: string;
}

export interface ExecuteWorkflowInput {
  request: Record<string, unknown>;
  /** Overrides the default agent-call timeout for this execution, in seconds. */
  agentTimeoutSec?: number;
}

export interface ExecuteWorkflowOptions {
  /**
   * Sent as the transport's `Idempotency-Key` AND used by workflow-service to
   * derive a deterministic Temporal workflow id
   * (`<tenant>:<name>:<idempotencyKey>`), rejecting duplicate starts.
   */
  idempotencyKey?: string;
}

export interface ExecuteWorkflowResult {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  runId: string;
  /** `true` when a duplicate start (same idempotencyKey) was ignored — treat as an idempotent ack. */
  alreadyStarted?: boolean;
}

/** One row of `GET /workflows/:id/executions` or `GET /workflows/executions` (by correlation). */
export interface WorkflowExecutionListItem {
  id: string;
  definitionId: string;
  tenantId: string;
  temporalWorkflowId: string;
  temporalRunId: string;
  request: unknown;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** Raw envelope returned by `GET /workflows/:id/executions` (`IWorkflowExecutionsPage`). */
export interface WorkflowExecutionsPage {
  items: WorkflowExecutionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListExecutionsParams {
  /** Page size requested per underlying `page`/`pageSize` call. Default 20 (the API's own default), max 100 (API-enforced). */
  pageSize?: number;
  /** Item offset to start iterating from. Default 0. */
  startOffset?: number;
  /** Sort by `created_at`. Default `"desc"` (the API's own default). */
  sort?: "asc" | "desc";
}

export interface WorkflowFailureInfo {
  message: string;
  type: string;
  activityName?: string;
  cause?: string;
}

/** Response shape for `GET /workflows/:id/executions/:executionId` (`IExecutionStatusResult`). */
export interface ExecutionStatusResult {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  status: string;
  result?: unknown;
  failure?: WorkflowFailureInfo;
  createdAt: string;
}

/** One row of `topByExecutionCountLast7d` in {@link WorkflowsSummary} (`ITopDefinitionRow`). */
export interface WorkflowsSummaryTopDefinition {
  definition_id: string;
  name: string;
  application: string;
  count: number;
}

/**
 * Response shape for `GET /workflows/summary` (`IWorkflowsSummary`,
 * `workflow-service`'s `WorkflowsService.getWorkflowsSummary`).
 */
export interface WorkflowsSummary {
  activeDefinitions: number;
  definitionsFailingNow: number;
  definitionsWithFailuresLast7d: number;
  executionsCompletedLast7d: number;
  executionsFailedLast7d: number;
  executionsRunningLast7d: number;
  executionsCompletedLast24h: number;
  topByExecutionCountLast7d: WorkflowsSummaryTopDefinition[];
}
