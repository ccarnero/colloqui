# Async / Long-Running Execution Resilience Audit

> Goal: verify that the platform's messaging and "submit → ID → poll" patterns actually survive executions that exceed HTTP timeouts — AI agent runs chaining into connector (HTTP) and MCP calls.
> Date: 2026-07-07. Code is the source of truth; every claim carries `file:line` evidence.

## Verdict per path

| # | Path | Verdict | One-liner |
| --- | --- | --- | --- |
| 1 | Agent execution (gateway → NATS → agent-ai-service) | **RESILIENT** (with a dead-code exception, F3) | Client traffic is 202 → JetStream → status via Redis + SSE/poll; no client HTTP awaits the LLM |
| 2 | Workflow execution | **RESILIENT** | `POST /workflows/:id/execute` returns 202, runs on Temporal; poll via `GET :id/executions/:executionId`; agentCall activity has 15-min Temporal timeout + heartbeat |
| 3 | Jobs (submit → ID → poll) | **PARTIAL** | Pattern implemented correctly (Redis status TTL 3600s, JetStream dedup via `Nats-Msg-Id`) but consumer side inherits F1 |
| 4 | Service-bus semantics | **VULNERABLE** | F1: 60s ackWait under multi-minute handlers → redelivery → duplicate LLM executions |
| 5 | Connector calls | **RESILIENT** | Temporal activities, 30s fetch timeouts, retries, distributed circuit breaker; nothing upstream blocks on them |
| 6 | MCP calls | **PARTIAL** | Temporal `mcpCall` safe (25s timeout); live-chat tool-bridge path has NO timeout (F2) |
| 7 | Streaming | **RESILIENT** | Core-NATS `rt.<tenant>.exec.<id>.token` + SSE; subscribe-before-submit (race-free); bounded relay buffer (256 ev/256KB → `slow_consumer`); cancel-on-disconnect aborts `streamText`; SSE heartbeats ~15s; Knative timeout 3600s |
| 8 | Sync-await gap hunt | 2 confirmed gaps | F3 (dead sync endpoint), F4 (buffered path lacks abort) |

## Findings

### F1 — CRITICAL: agent-ai-service consumer ackWait 60s under multi-minute LLM handlers

The single multi-tenant durable consumer (`agent-ai-service-consumer`) handling `chat_respond`, `job_trigger`, `execution_requested` uses the default `ackWait = 60s` and never calls `msg.working()`, while its handlers run `generateReply` — LLM calls with tool/MCP chains that routinely take minutes. JetStream redelivers the unacked message → **duplicate concurrent LLM execution**: double cost, double side effects, racing writes to the Redis result key, duplicate `execution_completed` publishes.

Evidence:
- No `ackWaitMs` override: `services/agent-ai-service/src/modules/nats-consumer/multi-tenant-consumer.service.ts:36-42`
- Default 60s: `packages/database/src/nats-durable-consumer.ts:30` (`DEFAULT_ACK_WAIT_MS = 60_000`)
- Ack only after full handler resolves; zero `working()` calls: `packages/database/src/nats-consumer-runner.ts:461-462`
- The correct pattern already exists in-repo: `tenant-provision-consumer.service.ts:57` and `ingestion-worker.service.ts:90` set `ackWaitMs: 300_000`

Fix:
1. Immediate: set `ackWaitMs` (≥900_000, matching `AGENT_CALL_TIMEOUT_MS`) + suitable `backoffMs` on this consumer.
2. Structural: periodic `msg.working()` inside long handlers (JsMsg supports in-progress ack extension), or split the durable by latency class.
3. Lock: K7 — table-driven test asserting every durable consumer whose handler can exceed 60s declares an explicit `ackWaitMs`.

### F2 — HIGH: live-chat MCP calls have no timeout

`McpClientService` (`services/agent-ai-service/src/modules/tools/mcp-client.service.ts:34-36`) calls `createMCPClient({ transport })` and executes tools with no `AbortSignal`/timeout. An unresponsive MCP server hangs the LLM tool-call step indefinitely — inside the same under-ack-wait consumer as F1, guaranteeing redelivery/duplicate cycles plus an orphaned un-cancelable execution once the message is `term()`'d to DLQ.

Contrast: the Temporal path already does it right — `MCP_CALL_TIMEOUT_MS = 25_000` (`services/connector-runtime/src/activities/mcp-call.activity.ts:18,143-176`).

Fix: wrap connect/tool-call with the same `withTimeout`/`AbortSignal.timeout` pattern; make it configurable per MCP server.

### F3 — MEDIUM: dead synchronous execution endpoint

`POST /execution` on agent-ai-service (`src/modules/execution/execution.controller.ts:28-45`) synchronously awaits the full `generateReply` (incl. tool/MCP calls) with no timeout and no job/poll fallback. No in-repo caller today, but it is a live route reachable service-to-service.

Fix: remove it, or make it delegate to the submit/poll job path.

### F4 — MEDIUM: buffered execution path has no abort plumbing

`handleBuffered` (`services/agent-ai-service/src/nats-handlers/execution.handler.ts:138-199`) has no `AbortController`/wall-clock timeout of its own (unlike `handleStreaming`). If the caller's `waitForExecutionResult` gives up, the LLM keeps burning compute with no consumer; result lands in Redis (TTL 3600s) but the compute is never cancelled.

Fix: mirror the streaming path's `AbortController` + cancel-subject subscription in `handleBuffered`.

## Verified-OK — patterns that hold, and their locks

| Pattern | Evidence | Proposed lock |
| --- | --- | --- |
| Workflow execute is async (202 + Temporal) | `workflow-service/src/modules/workflows/workflows.controller.ts:112-131` | Contract test: 202 in <200ms with a mocked slow activity |
| Submit+stream race-free (subscribe before submit) | `ai-agent-gateway/src/modules/executions/executions.service.ts:354-375` | Test: completion firing immediately after submit still reaches the SSE subscriber |
| Streaming relay bounded (256 events / 256 KB) | `executions.service.ts:49-57,246-256` | Test: overflow terminates with `failed{reason:"slow_consumer"}`; result still pollable |
| Connector calls only inside Temporal activities | `endpoint-call.activity.ts:42`, `service-call.activity.ts:241` | Arch test: no `execute*Call` reachable from a `@Controller` without a `proxyActivities` boundary |
| Circuit breakers (http: 5/60s→30s open; agent: 10/120s→60s open) | `connector-runtime/src/activities/_shared/breaker.ts:17-26` | Unit tests on both breaker configs |
| Knative timeout ceiling covers 15-min agent calls | `knative/serving/config-defaults.yaml:15-16`, `knative/services/base/ai-agent-gateway.yaml:25` | CI yq: `timeoutSeconds` ≥ 900s + margin on both gateways |
| JetStream dedup on submit | `Nats-Msg-Id` usage in `packages/shared/src/execution-client.ts` | Test: double-submit same execution ID → single delivery |
| Cancel-on-disconnect aborts streaming compute | `execution.handler.ts` cancel control message → `streamText` abort | Test: client disconnect publishes cancel; handler abort observed |

## Timeout inventory

| Config key / constant | Value | File:line |
| --- | --- | --- |
| `PROXY_TIMEOUT_MS` (api-gateway proxy) | 30,000 ms | `services/api-gateway/src/constants.ts:5` |
| `FETCH_TIMEOUT_MS` (dynamic route cache) | 5,000 ms | `services/api-gateway/src/modules/dynamic-routes/dynamic-route-cache.service.ts:29` |
| `VERIFY_TIMEOUT_MS` (webhook verify RPC) | 5,000 ms | `services/api-gateway/src/modules/channels/webhook-verify-rpc.client.ts:19` |
| `HEALTH_TIMEOUT_MS` / `AUDIT_TIMEOUT_MS` (dashboard proxy) | 4,000 / 8,000 ms | `services/api-gateway/src/modules/dashboard/dashboard-proxy.service.ts:27-28` |
| `SERVICE_TIMEOUT_MS` (gateway health) | 3,000 ms | `services/api-gateway/src/modules/health/gateway-health.service.ts:29` |
| `WEBHOOK_PUBLISH_TIMEOUT_MS` | 10,000 ms | `services/api-gateway/src/config/gateway.config.ts:116` |
| `AGENT_CALL_TIMEOUT_MS` (Temporal agentCall, overridable `agentTimeoutSec`) | 900,000 ms | `services/workflow-service/src/temporal/activities/agent-call.activity.ts:19-22` |
| `WORKFLOW_DEFAULT_TIMEOUT_MS` | 600,000 ms | `packages/shared/src/constants.ts:72` |
| `WORKFLOW_TASK_TIMEOUT_MS` | 30,000 ms | `packages/shared/src/constants.ts` |
| `RAW_TIMEOUT_MS` (connector raw endpoint call, no retries) | 30,000 ms | `services/connector-runtime/src/activities/endpoint-call.activity.ts:42,282` |
| `SERVICE_CALL_TIMEOUT_MS` (+ registry lookup) | fetch `AbortSignal.timeout` | `services/connector-runtime/src/activities/service-call.activity.ts:241,262` |
| `MCP_CALL_TIMEOUT_MS` (Temporal mcpCall) | 25,000 ms | `services/connector-runtime/src/activities/mcp-call.activity.ts:18` |
| `CONFIG_LOOKUP_TIMEOUT_MS` (mcpCall config fetch) | 10,000 ms | `services/connector-runtime/src/activities/mcp-call.activity.ts:16` |
| Live-chat MCP client | **none** | `services/agent-ai-service/src/modules/tools/mcp-client.service.ts:34-36` (F2) |
| httpBreaker | 5 fails/60s → 30s open | `services/connector-runtime/src/activities/_shared/breaker.ts:17-20` |
| agentBreaker | 10 fails/120s → 60s open, 300s probe | `breaker.ts:22-26`, `agent-call.activity.ts:103-112` |
| `DEFAULT_ACK_WAIT_MS` (NATS durable default) | 60,000 ms | `packages/database/src/nats-durable-consumer.ts:30` |
| `DEFAULT_BACKOFF_MS` | 60s/120s/300s/600s | `packages/database/src/nats-durable-consumer.ts:43-48` |
| `DEFAULT_MAX_DELIVER` / `DEFAULT_MAX_ACK_PENDING` | 5 / 1000 | `packages/database/src/nats-durable-consumer.ts:12-13` |
| agent-ai-service consumer ackWait | **60,000 ms — no override (F1)** | `services/agent-ai-service/src/modules/nats-consumer/multi-tenant-consumer.service.ts:36-42` |
| tenant-provision consumer ackWait | 300,000 ms | `services/tenant-service/src/modules/provisioning/tenant-provision-consumer.service.ts:57` |
| ingestion-worker / skb-ingestion-worker ackWait | 300,000 ms | `.../knowledge-bases/ingestion-worker.service.ts:90`, `.../structured-kb/skb-ingestion-worker.service.ts:93` |
| trigger-consumer ackWait / maxDeliver | 60,000 ms / 3 | `services/workflow-service/src/modules/triggers/trigger-consumer.service.ts:101-102` |
| `RESULT_TTL` / `PENDING_TTL` (Redis execution status) | 3,600 s | `packages/shared/src/constants.ts` |
| `STREAM_RELAY_MAX_EVENTS` / `STREAM_RELAY_MAX_BYTES` | 256 / 256 KB | `services/ai-agent-gateway/src/modules/executions/executions.service.ts:56-57` |
| Knative `revision-timeout-seconds` (both gateways) | 3,600 s | `knative/services/base/{api-gateway.yaml:30, ai-agent-gateway.yaml:25}` |
| Knative `max-revision-timeout-seconds` | 3,600 s | `knative/serving/config-defaults.yaml:15-16` |

## Fix order

1. **F1** — one-line `ackWaitMs` on the agent-ai-service consumer (immediate), then `msg.working()` support (structural). Ship lock K7 with it.
2. **F2** — timeout on live-chat MCP client, config per server.
3. **F4** — AbortController in `handleBuffered`.
4. **F3** — remove or asyncify the dead `POST /execution` endpoint.
5. Implement the Verified-OK locks so today's RESILIENT verdicts stay true.
