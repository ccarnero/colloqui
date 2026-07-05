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
 * STREAMING (resolved 2026-07-05, see DOCS/architecture/runtime-streaming.md
 * and platform/runtime-streaming-design engram decision #591): the gateway
 * now proxies the combined submit+stream endpoint end-to-end —
 * `services/api-gateway/src/modules/runtime/runtime.controller.ts`
 * (`POST runtime/executions/stream`) → `runtime-proxy.service.ts`
 * `proxyStream()` (hijack + `pipeUpstreamSseToReply` — 15s `:hb` heartbeat,
 * abort-on-client-disconnect) → `ai-agent-gateway`'s
 * `executions.controller.ts` `submitAndStream()` (`@Post("stream") @Sse()`)
 * → `executions.service.ts` `submitAndStream()`, which race-free-subscribes
 * to NATS token/tool/lifecycle subjects before submitting the execution and
 * relays them as `MessageEvent { type, data }` over SSE, bounded by a
 * 256-event/256KB relay buffer (overflow → `failed{reason:"slow_consumer"}`).
 *
 * The wire event `type` values (verified in `executions.service.ts`,
 * `emit()`/`closeWithFailure()`): `"started"`, `"token"`, `"tool_call"`,
 * `"tool_result"`, `"completed"`, `"failed"`. `data` shapes:
 *
 * - `started`/`completed`: the lifecycle status payload — same shape as
 *   {@link ExecutionStatus} (verified: `executions.service.ts` emits the raw
 *   NATS `YoizenClawExecutionStatus`-derived payload, not the GET-normalized
 *   one, but the fields overlap for `executionId`/`agentId`/`state`/`result`).
 * - `failed`: `{ executionId: string; reason: string }` ONLY — verified in
 *   `executions.service.ts` `closeWithFailure()`
 *   (`subscriber.next({ type: "failed", data: { executionId, reason } })`).
 *   NOTE this deliberately omits the separate `error` field the design doc's
 *   §4.1 sketch showed; the real code never sets one. `reason` carries
 *   values like `"slow_consumer"`, `"cancelled"`, or an upstream error
 *   message forwarded as a string.
 * - `token`: `RuntimeTokenPayload` from
 *   `packages/shared/src/runtime-stream.interfaces.ts`
 *   (`{ executionId, agentId, seq, delta, done }`).
 * - `tool_call` / `tool_result`: `RuntimeToolCallPayload` /
 *   `RuntimeToolResultPayload` from the same file. The original design's v1
 *   scope note said "token-only", but `executions.service.ts`'s
 *   `tokenKindBySuffix` map already relays all three kinds today, so the SDK
 *   types them now (forward-compatible, no cost to include).
 *
 * There is NO `capabilities.streaming` flag anywhere in the platform
 * (verified: `runtime-health.controller.ts` just proxies raw `/health`) —
 * the design doc's §4.4 "preferred: capability probe" auto-fallback was
 * never built. `stream()` below degrades via 404/405 detection on the
 * stream route itself instead: `Transport.requestStream()` throws
 * `SdkError` with `code: "streaming_unsupported"` when opening the
 * connection 404s/405s, and callers who want automatic degradation catch
 * that code and fall back to `createExecution()` + poll `getExecution()`
 * themselves (see the doc comment on `stream()` in `./client.ts`).
 */

/**
 * Discriminated union of `runtime.stream()` events, typed from the verified
 * wire shapes above (`packages/shared/src/runtime-stream.interfaces.ts` +
 * `services/ai-agent-gateway/src/modules/executions/executions.service.ts`).
 * `failed` is a normal (non-throwing) terminal event — see `./client.ts`.
 */
export type RuntimeStreamEvent =
  | { type: "started"; data: ExecutionStatus }
  | { type: "token"; data: RuntimeTokenEventPayload }
  | { type: "tool_call"; data: RuntimeToolCallEventPayload }
  | { type: "tool_result"; data: RuntimeToolResultEventPayload }
  | { type: "completed"; data: ExecutionStatus }
  | { type: "failed"; data: RuntimeStreamFailedPayload };

/** `packages/shared/src/runtime-stream.interfaces.ts` `RuntimeTokenPayload`. */
export interface RuntimeTokenEventPayload {
  executionId: string;
  agentId: string;
  seq: number;
  delta: string;
  done: boolean;
}

/** `packages/shared/src/runtime-stream.interfaces.ts` `RuntimeToolCallPayload`. */
export interface RuntimeToolCallEventPayload {
  executionId: string;
  agentId: string;
  seq: number;
  toolName: string;
  args: Record<string, unknown>;
}

/** `packages/shared/src/runtime-stream.interfaces.ts` `RuntimeToolResultPayload`. */
export interface RuntimeToolResultEventPayload {
  executionId: string;
  agentId: string;
  seq: number;
  toolName: string;
  result: unknown;
  isError: boolean;
}

/**
 * Verified shape of `failed` events' `data` field
 * (`executions.service.ts` `closeWithFailure()`) — NOT the design doc's
 * `§4.1` sketch, which additionally showed an `error` field the real code
 * never sets. `reason` is e.g. `"slow_consumer"`, `"cancelled"`, or a
 * forwarded upstream error message.
 */
export interface RuntimeStreamFailedPayload {
  executionId: string;
  reason: string;
}

export interface RuntimeStreamOptions {
  /** Aborts the stream at any point; the async iterator ends cleanly (no throw) on abort. */
  signal?: AbortSignal;
}

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
