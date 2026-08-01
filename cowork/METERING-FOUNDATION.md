# Metering Foundation — Audit & Plan

> Goal: leave the platform PREPARED to derive usage metrics — per message, conversation,
> workflow execution, agent, and dimensions not yet known — from durably persisted,
> attributable, idempotent, recountable records. This is the foundation for future
> usage-based billing; it deliberately does NOT implement pricing units or counters.
> Date: 2026-07-07. Evidence audited read-only against the running codebase.

## Foundation properties

Every metering-relevant action must satisfy:
1. **Durable event** — persisted in Postgres/Mongo, not Redis/TTL/stream-retention.
2. **Full attribution** — tenant, agent, conversation, channel, workflow, execution, correlation/causation.
3. **Idempotent counting** — redelivery/retry cannot double-count (reference pattern: usage-aggregator's `ON CONFLICT (idempotency_key, ts) DO NOTHING`, `batch-inserter.postgres.ts:70`).
4. **Recountable** — any future metric can be recomputed from the persisted records alone.

## Scorecard (as-is)

| Action | Durable store + writer | Missing attribution | Idempotent | Recountable | Verdict |
|---|---|---|---|---|---|
| Inbound/outbound message | `channel_events` (`channel-audit.service.ts:49-72`, `ON CONFLICT (id)`) | conversationId (JSONB-buried, not a column) | YES | YES | **OK**− |
| Channel usage rollup | usage-aggregator (`batch-inserter.postgres.ts:70`) | agentId, conversationId, executionId | YES | YES | OK/PARTIAL |
| Connector call | usage-aggregator (`batch-inserter.connector.ts:67`) | correlation to triggering execution | YES | YES | **OK** |
| **Agent execution (tokens/costUsd)** | **Redis only, TTL 3600s** (`execution-client.ts:313-326`) | everything, after 1h | n/a | **NO** | **MISSING** |
| Agent cost rollup | Redis daily hash, TTL 90d (`cost-tracker.service.ts:74-83`) | conversation/execution/model detail | **NO** (hincrby double-counts) | NO | **MISSING** |
| Scheduled job execution | `job_executions` (status only) | tokens/cost/agent/conversation | partial | status only | PARTIAL |
| Workflow execution | `workflow_executions` (`execution-projector.service.ts:242-268`, documented idempotent) | cost/duration, causation depth | YES | YES (lifecycle) | OK/PARTIAL |
| MCP tool call | `mcp_call_events` — plain INSERT via fire-and-forget `void fetch` (`mcp-usage-client.ts:19-34`) | correlation/execution/conversation ids | **NO** | lossy | **MISSING** |
| SKB query | `skb_query_history` | execution linkage | no key | YES | PARTIAL |
| Doc-KB usage | — (no per-call usage rows) | all | n/a | NO | **MISSING** |
| Streaming execution final usage | — (terminal event not durably persisted) | all | n/a | NO | **MISSING** |

## Critical structural finding

`audit-service`'s canonical consumer pattern `evt.*.*.platform.>` (`audit.service.ts:47`) only
matches envelopes whose domain token is `platform`. Every execution lifecycle event
(`execution_requested/started/completed/failed`) and `config_sync` uses
`AUTOMATION_DOMAIN = "automation"` (named `PLATFORM_DOMAIN` until 2026-08-01,
`packages/shared/src/constants.ts`).
**No consumer audits automation-domain events at all** — a subject-filter mismatch, not a
documented decision. The "service that subscribes to everything and writes Postgres" has a
blind spot exactly over the platform's highest-value metering unit.

## Ephemerality risks

- Agent execution usage: Redis `RESULT_TTL=3600s` — evaporates hourly.
- Cost tracker: Redis daily aggregate, 90d TTL, double-counts on redelivery.
- Temporal retention 24h (`job-namespace-bootstrap.yaml:70`) — correctly not relied upon.
- INGRESS streams: tier-bound retention (free 7d) — consumer gaps cannot be backfilled after max_age.

## Plan (ordered by leverage)

| # | Change | Where | Status |
|---|---|---|---|
| G1 | Durable execution-events sink: `execution_events` table (Postgres+Mongo), one row per lifecycle event with `executionId, tenant, agent, conversationId, model, provider, input/output/cached tokens, costUsd, status, error, correlation/causation/depth, occurred_at`; idempotent by envelope id; `GET /audit/execution-events` query endpoint | audit-service | **DONE 2026-07-07** (`src/modules/execution-audit/*`) |
| G2 | Automation-domain audit blind spot closed via dedicated `execution-audit` durable consumer on `evt.*.ai-agent-gateway.automation.platform.internal.execution_*.v1` (canonical `platform`-domain consumer left untouched) | audit-service | **DONE 2026-07-07** |
| G3 | `conversationId` first-class: optional `InboundMessage.conversationId` → envelope factory → `channel_events.conversation_id` column + `(tenant_id, conversation_id)` index + query filter. No current producer sets it — capability is wired, ready for producers | packages/shared, channel-service, audit-service | **DONE 2026-07-07** |
| G4 | `mcp_call_events` idempotency: producer-generated `eventId` = PK with `ON CONFLICT (id) DO NOTHING` (Mongo `_id` + dup-key no-op); usage client rewritten with bounded 3-attempt backoff retry, still never-throwing | packages/shared, agent-admin-service, call sites | **DONE 2026-07-07** |
| G5 | Attribution ids (`correlation_id`, `causation_id`, `execution_id`, nullable) on `mcp_call_events` + `skb_query_history`; threaded from live-chat tool context (conversationId → correlationId, executionId) and Temporal causal context; SKB plumbing ready, admin-API caller has none today | agent-admin-service, agent-ai-service, connector-runtime, workflow-service | **DONE 2026-07-07** |
| G6 | Durable per-call LLM cost events (append-only ICostEvent log) | agent-ai-service | **DEFERRED** — G1 persists per-execution token/cost totals durably, which covers execution/conversation/agent/tenant metering. Revisit only if a pricing unit needs intra-execution (per-LLM-step) granularity |
| G7 | Workflow execution cost/duration columns | workflow-service | **DEFERRED** — workflow-triggered agent executions are now visible in `execution_events` and joinable via correlation/causation ids; add columns only if direct workflow-level rollups become a pricing unit |

Non-goals (explicit): pricing units, aggregation jobs, billing APIs, dashboards. Those are
queries over this foundation, added when pricing is defined.
