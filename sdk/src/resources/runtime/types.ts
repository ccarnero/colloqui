/**
 * Request/response types for the `runtime` resource (`runtime/executions`),
 * hand-typed against the REAL gateway + downstream shapes (verified
 * 2026-07-04, see sdk/GROWTH-PLAN.md Phase 2):
 *
 * - `services/api-gateway/src/modules/runtime/runtime.controller.ts` +
 *   `runtime.dto.ts` (`CreateExecutionDto`) — gateway routes: `POST
 *   /runtime/executions`, `GET /runtime/executions/:id`. Raw passthrough via
 *   `RuntimeProxyService` (`runtime-proxy.service.ts`) to `ai-agent-gateway`.
 * - `services/api-gateway/src/modules/runtime/runtime-health.controller.ts`
 *   — `GET /runtime/health` (`@Public`, no tenant/auth required).
 * - `services/ai-agent-gateway/src/modules/executions/executions.controller.ts`
 *   + `executions.service.ts` — the real downstream shapes:
 *   `POST /runtime/executions` returns `{ executionId, status: "accepted" }`
 *   (`YoizenClawExecutionSubmitted` in `packages/shared/src/execution.interfaces.ts`);
 *   `GET /runtime/executions/:id` returns a normalized envelope built by
 *   `ExecutionsService.getExecution` (NOT the raw `YoizenClawExecutionStatus`).
 *
 * STREAMING GAP (verified, see sdk/README.md "Resource clients" and the
 * agents/runtime write-up): two distinct streaming endpoints exist
 * downstream and NEITHER is proxied by the gateway:
 *
 * 1. `ai-agent-gateway`'s `ExecutionsController` exposes `@Sse("stream")` at
 *    `GET runtime/executions/stream` (NATS-backed execution status events:
 *    started/completed/failed). The gateway's `RuntimeController` has no
 *    matching route, and `RuntimeProxyService.proxy()` only does a single
 *    `tracedFetch()` + `res.json()` — it has no SSE/`ReadableStream`
 *    handling and would break on an `event-stream` response body anyway.
 * 2. `agent-ai-service`'s `ExecutionController` exposes `POST
 *    execution/stream` (raw LLM token streaming via `text/event-stream`).
 *    This is a DIFFERENT service than the one `runtime/executions` proxies
 *    to (`ai-agent-gateway`, not `agent-ai-service`), and per GROWTH-PLAN.md
 *    invariant 5 the SDK must talk only to the gateway — so even if this
 *    were proxied, the SDK would go through the gateway's proxy, not this
 *    service directly.
 *
 * Since neither streaming route is proxied, this resource intentionally has
 * NO `stream()` method. Add the missing gateway proxy route (forwarding the
 * `ai-agent-gateway` SSE stream, since that is the one that shares the
 * `runtime/executions` base path) before adding a client method here.
 */

export interface ExecutionContextEntry {
  sender: "customer" | "agent";
  content: string;
}

export interface CreateExecutionInput {
  agentId: string;
  message: string;
  conversationId?: string;
  customerName?: string;
  userId?: string;
  channel?: string;
  context?: ExecutionContextEntry[];
}

/** Response shape for `POST /runtime/executions` (`YoizenClawExecutionSubmitted`). */
export interface CreateExecutionResult {
  executionId: string;
  status: "accepted";
}

export interface ExecutionResultPayload {
  reply?: string;
  response?: string;
  toolCalls?: unknown;
  usage?: unknown;
  costUsd?: unknown;
  model?: unknown;
  provider?: unknown;
}

/**
 * Response shape for `GET /runtime/executions/:id`, as normalized by
 * `ai-agent-gateway`'s `ExecutionsService.getExecution` (NOT the raw Redis
 * `YoizenClawExecutionStatus` — that shape is re-mapped for frontend
 * compatibility, e.g. `result.reply` / `result.response` both carry the same
 * value).
 */
export interface ExecutionStatus {
  executionId: string;
  tenantId: string;
  type: string;
  /** e.g. `"pending" | "running" | "completed" | "failed"` — see `YoizenClawExecutionState`. */
  state: string;
  /** ISO-8601 timestamp. */
  requestedAt: string;
  /** ISO-8601 timestamp, present once execution starts. */
  startedAt?: string;
  /** ISO-8601 timestamp, present once execution finishes. */
  completedAt?: string;
  agentId: string;
  result: ExecutionResultPayload;
}

/** Response shape for `GET /runtime/health` (proxied `ai-agent-gateway` health check, `@Public`). */
export interface RuntimeHealth {
  [key: string]: unknown;
}
