# Workflow Engine

Class: descriptive
Summary: How workflow orchestration works: the two-process split (NestJS API plus Temporal worker), trigger-to-execution flow, action dispatch and scaling.

This document explains how workflow orchestration works in the platform: process boundaries, trigger-to-execution flow, action dispatch model, and scaling.

## Two-Process Architecture

The workflow engine runs as two independent processes from the same service codebase:

- `workflow-service-api` (HTTP API): workflow CRUD and execution management.
- `workflow-service-worker` (Temporal worker): workflow execution and trigger handling.

```mermaid
flowchart LR
    client[api-gateway / internal callers] --> api[workflow-service-api]
    api --> temporal[(Temporal)]

    nats[(NATS INGRESS-<tenant>)] --> trigger[TriggerConsumerService]
    trigger --> temporal

    temporal --> worker[workflow-service-worker]
    worker --> local[Local activities]
    worker --> crt[connector-runtime queue]
```

## Trigger Consumer

`TriggerConsumerService` in `workflow-service-worker` is the NATS-to-Temporal bridge for message-based automation.

- Consumes `evt.*.channel-service.messaging.*.*.received.v1` from tenant streams `INGRESS-*` using durable `workflow-triggers`.
- Resolves matching definitions where `trigger.type = message_received`.
- Applies trigger filters (`accountIds`, `channels`, `providers`, `patterns`).
- Supports `exclusive` and `shared` trigger modes: when any matching definition has `mode: "exclusive"`, only the first exclusive one fires; otherwise all shared workflows fire.
- Starts Temporal workflows with idempotency (`idempotencyKey = "${envelope.idempotencykey}:${def.id}"`, omitted entirely when the envelope carries no `idempotencykey`) and causal-chain propagation (`causation_id`, `correlation_id`, `transport.depth` extracted from the triggering envelope per DOCS/messaging/envelope.md §6).

Incoming large payloads (>256 KB) are transparently inflated before the handler runs via the claim-check middleware in `MultiTenantConsumerManager.wrapHandler` (`packages/database/src/multi-tenant-consumer-manager.ts`). The consumer itself is unaware of the claim-check; it always sees a fully inflated envelope.

### Trigger account filters vs outbound sends

The trigger's `accountIds` filter only controls which inbound messages fire the workflow. It does **not** restrict which accounts outbound `channelSend` actions may use — the engine sends on any account the tenant owns.

The workflow builder (admin-console) surfaces a non-blocking **warning** when an outbound `channelSend` pins a fixed `accountId` that is not in the trigger's `accountIds` selection (`workflow.validator.ts`, code `INVALID_VALUE` on `args.accountId`). The user must acknowledge it ("Save anyway") but the save proceeds. It is a warning rather than an error because both readings are valid:

- **Stale config** — the user narrowed the trigger after configuring the outbound node. The warning is the safety net for this case.
- **Cross-account notify** — a deliberate pattern where the workflow listens on one account and notifies through a dedicated output account (e.g. an `output-*` Telegram bot) that the trigger intentionally does not listen on. Adding the output account to the trigger would wrongly fire the workflow on messages sent *to* the notify bot.

Outbound nodes using the "Same as incoming message" sentinel (`{{request.envelope.accountId}}`) never warn: they resolve at runtime to the account that received the triggering message. An empty trigger `accountIds` selection means "listen on any account" and also skips the check.

## Action Types

Current supported actions in `runWorkflow`:

| Action | Task queue | Timeout | Behavior |
|---|---|---|---|
| `endpointCall` | `connector-runtime` | 30 s (5 attempts) | Outbound HTTP call (connector-aware when adapterId/endpointId configured) |
| `serviceCall` | `connector-runtime` | 30 s (5 attempts) | Internal service HTTP call (mirror/fallback resolution) |
| `mcpCall` | `connector-runtime` | 30 s (5 attempts) | Calls a tool on a connected MCP server — shares the `http` proxy with `endpointCall`/`serviceCall`; see [mcp-connections.md](../architecture/mcp-connections.md) |
| `agentCall` | `workflow-orchestrator` (local) | 15 m start-to-close, 30 s heartbeat (3 attempts) | Agent execution via `YoizenClawExecutionClient` over JetStream |
| `jsFunction` | `workflow-orchestrator` (local) | 30 s (3 attempts) | Inline JavaScript execution |
| `serviceBusCall` | `workflow-orchestrator` (local) | 30 s (3 attempts) | Publishes message to NATS subject for tenant |
| `channelSend` | `workflow-orchestrator` (local) | 30 s (3 attempts) | Publishes channel send command envelope |
| `branch` | workflow control | — | Parallel branch execution; branch results are merged back into the main context |
| `conditional` | workflow control | — | Sequential condition evaluation; first matching branch executes |

These nine are the whole `WorkflowAction` union in `packages/shared/src/workflow.interfaces.ts`; `runWorkflow`'s dispatch switch has exactly one `case` per member.

Notes:

- `serviceBusCall` publishes to the tenant stream path (subject provided by action args); envelope structure and subject conventions are documented in `DOCS/messaging/service-bus.md`.
- `agentCall` runs on the orchestrator queue (no separate task queue) and uses `YoizenClawExecutionClient` which publishes `execution_requested.v1` over JetStream and subscribes for lifecycle events; see `DOCS/agents/execution.md`.
- `endpointCall` and `serviceCall` use an extended retry policy (max 5 attempts, 1 s → 30 s exponential backoff) designed to ride out one full circuit-breaker cooldown window (30 s).

## Action Dispatch Model

`runWorkflow` executes actions sequentially. For each action, templates are resolved from execution context (`request`, `results`, `workflow`, `variables`) before dispatch.

```mermaid
flowchart LR
    wfw[workflow-service-worker]
    wfw --> local[workflow-orchestrator queue\njsFunction / serviceBusCall\nchannelSend / agentCall]
    wfw --> crt[connector-runtime queue\nendpointCall / serviceCall / mcpCall]
    wfw --> branch[branch control\nparallel sub-actions]
    wfw --> cond[conditional control\nexclusive branch evaluation]
```

## Execution Lifecycle Publishers

One `publisher` activity proxy on the orchestrator queue (`startToCloseTimeout: "5s"`, max 2 attempts) carries the whole best-effort tracking family, all defined in `execution-completed-publisher.activity.ts` and all publishing to `INGRESS-<tenant>`:

| Activity | Subject |
|---|---|
| `publishExecutionStartedEvent` | `evt.<tenant>.workflow-service.workflow.internal.native.execution_started.v1` |
| `publishExecutionCompletedEvent` (every run, success or failure) | `evt.<tenant>.workflow-service.workflow.internal.native.execution_completed.v1` |
| `publishActionStartedEvent` / `publishActionCompletedEvent` | per-action siblings in the same family |
| `publishConditionEvaluatedEvent` | condition-evaluation sibling |

Only the `execution_completed` subject is projected: the `workflow-api`'s `ExecutionProjectorService` binds durable `workflow-projector` with `filterSubject = evt.*.workflow-service.workflow.internal.native.execution_completed.v1` and batches UPDATEs into `workflow_executions` (batch cap 100), decoupling the hot path from Postgres writes.

## Task Queue Topology and Scaling

- Orchestrator execution queue: `workflow-orchestrator` (`WORKFLOW_ORCHESTRATOR_TASK_QUEUE`).
- HTTP activity queue: `connector-runtime` (`CONNECTOR_RUNTIME_TASK_QUEUE`).
- `connector-runtime` workers self-configure max 400 concurrent activity executions per pod.

```mermaid
flowchart LR
    temporal[(Temporal)] --> orq[workflow-orchestrator]
    temporal --> crtq[connector-runtime]

    orq --> wworker[workflow-service-worker]
    crtq --> cr[connector-runtime deployment]
```

Note: KEDA Temporal scalers for connector-runtime are absent from the current dev-only configuration — the worker runs as a plain Deployment with a fixed replica count.

## References

- `services/workflow-service/src/temporal/workflows.ts`
- `services/workflow-service/src/temporal/activities/` (all activities)
- `services/workflow-service/src/modules/triggers/trigger-consumer.service.ts`
- `packages/database/src/multi-tenant-consumer-manager.ts` (claim-check middleware)
- `packages/shared/src/workflow.interfaces.ts`
- `DOCS/messaging/service-bus.md`
