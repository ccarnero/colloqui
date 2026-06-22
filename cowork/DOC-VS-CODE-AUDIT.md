# Doc-vs-Code Audit — Platform Cluster

> Goal: verify that the code does what the documentation (`DOCS/`) says it does.
> Method: I extracted concrete, falsifiable claims from each doc and cross-checked them against the
> real code (constants, timeouts, enums, handlers) using the `codebase-memory-mcp` graph + direct reads.
> Date: 2026-06-20.

## Executive Summary

**The documentation is very well aligned with the code.** I verified ~20 concrete claims;
the vast majority match exactly, and the docs even honestly flag what is
"pending / not implemented / stub". I found **3 discrepancies** (2 medium, 1 low). None is
a serious functional bug; the two medium ones are **stale docs** relative to code that moved forward.

| # | Severity | Type | Summary |
|---|---|---|---|
| 1 | 🟠 Medium | Stale doc | `overview.md` says "200 concurrent"; the code uses **400**. |
| 2 | 🟠 Medium | Stale doc | `service-bus.md` says stream tiers are "not connected"; they actually **are** wired (with a hardcoded `free` tier) in 2 services. |
| 3 | 🟡 Low | Internal doc inconsistency | `service-bus.md` lists the durable as `agent-ai-service`; the real one is `agent-ai-service-consumer`. |

---

## Discrepancies Found

### 1. 🟠 connector-runtime: concurrency 400, not 200 _(still open as of reconciliation 2026-06-22)_

- **What the doc says:** `DOCS/architecture/overview.md` states "Max **200** concurrent activity tasks" (in two places).
- **What the code does:** `maxConcurrentActivityTaskExecutions: 400` — `services/connector-runtime/src/worker.ts:35` (the comment even says *"400 doubles the…"*).
- **Who is right:** `DOCS/workflows/engine.md` and `DOCS/workflows/connector-vs-workflow.md` already say **400** correctly. The stale one is `overview.md` (the "canonical" doc).
- **Note:** `cowork/ARCHITECTURE-ANALYSIS.md` already says 400 correctly.
- **Suggested fix:** update `overview.md` to 400 (2 occurrences) — **pending**.

### 2. 🟠 Stream tiers: partially wired (contradicts "pending / not connected")

- **What the doc says:** `DOCS/messaging/service-bus.md` → *"`TENANT_TIER_LIMITS` is defined… Current stream provisioning uses the `CHANNEL_STREAM_MAX_AGE_NS` / `CHANNEL_STREAM_MAX_BYTES` defaults for all tenants. **The tier selection is not connected to the stream creation flow.**"*
- **What the code does:**
  - `TENANT_TIER_LIMITS` and `buildTenantStreamConfig` **are** used in the stream creation flow of **two** services:
    - `services/agent-admin-service/src/providers/nats.provider.ts:275,283,318-326`
    - `services/agent-memory-service/src/providers/nats.provider.ts:251,259,283-297`
  - Both call `buildTenantStreamConfig(tenantId, tier)` with a **hardcoded `"free"` tier** (they log *"No tier registered for tenant; using fallback tier 'free'"*). The `free` tier = **1 GB** `max_bytes` (not the 256 MB of `CHANNEL_STREAM_MAX_BYTES`).
  - In contrast, the shared helper `ensureTenantIngressStream` (`packages/database/src/nats-provider.ts:237-239`), used by tenant-service (primary path) + api-gateway/channel-service/registry, **does** apply the 256 MB defaults and **reconciles** `max_bytes`.
- **Why it matters:** the doc understates the real state (the tier machinery is already hooked in, just without per-tenant tier resolution). There is also a **latent `max_bytes` inconsistency**: an `INGRESS-<tenant>` stream created by agent-admin/agent-memory starts at 1 GB, while the shared helper creates/reconciles it to 256 MB — depending on which one creates it first (those providers only enforce limits on **creation**, they do not reconcile if the stream already exists).
- **Suggested fix:** either (a) update the doc to say "tiers are wired with a `free` fallback, per-tenant resolution is still missing", or (b) unify agent-admin/agent-memory to use the same helper/limit as the rest and avoid the 256 MB vs 1 GB drift.

### 3. 🟡 Inconsistent durable name within service-bus.md

- **What the doc says:** `service-bus.md` (section "Durable Consumer Lifecycle") lists *"typical durable names: … `agent-ai-service` …"*.
- **What the code does:** the real durable is **`agent-ai-service-consumer`** — `services/agent-ai-service/src/modules/nats-consumer/multi-tenant-consumer.service.ts:11`.
- **Who is right:** `DOCS/agents/execution.md` already uses `agent-ai-service-consumer` (matches the code). This is an internal inconsistency within `service-bus.md`.
- **Suggested fix:** correct the name in the `service-bus.md` listing.

---

## Verified Correct (code == doc)

All of the following were cross-checked and **match**:

**Messaging / service-bus + claim-check** (`packages/shared/src/channel.constants.ts`)
- `CHANNEL_STREAM_MAX_AGE_NS` = 7 days ✓ · `CHANNEL_STREAM_MAX_BYTES` = 256 MB ✓ · `CHANNEL_MAX_DELIVER` = 5 ✓
- `CLAIM_CHECK_THRESHOLD_BYTES` = 262144 (256 KB) ✓ · `CLAIM_CHECK_BUCKET_TTL_NS` = 7 days ✓ · `CLAIM_CHECK_BUCKET_MAX_BYTES` = 512 MB ✓
- 8-token subject taxonomy `evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>` ✓ (`envelope.utils.ts`)
- `ClaimCheckService` in agent-ai-service exists but **is not connected** to any handler ✓ (appears only in `claim-check.module.ts`) — the doc correctly marks it as "exists but unused".

**Workflows / engine** (`services/workflow-service/src/temporal/workflows.ts`)
- `endpointCall` / `serviceCall`: 30 s, `maximumAttempts: 5`, backoff coef 2, `maximumInterval: 30s` ✓ (lines 107-112)
- `agentCall`: `startToCloseTimeout: 15m`, `heartbeatTimeout: 30s`, `maximumAttempts: 3` ✓ (lines 120-125)
- Local activities (jsFunction/serviceBusCall/channelSend): 30 s, 3 attempts ✓
- `execution_completed` publisher: 5 s, 2 attempts ✓ (durable `workflow-projector` ✓)
- `TriggerConsumerService`: filter `evt.*.channel-service.messaging.*.*.received.v1`, durable `workflow-triggers`, `trigger.type === "message_received"` ✓ (`trigger-consumer.service.ts:51,96,272`)

**Agents — memory** (`services/agent-memory-service/src/modules/memory/domain/enums.ts`)
- `MemoryScope` (SESSION/USER/TENANT), `MemoryKind` (PREFERENCE/FACT/NOTICE/INCIDENT/PROMO), `MemoryStatus` (PROPOSED/ACTIVE/REJECTED/ARCHIVED), `MergeStrategy` (REPLACE/KEEP_BOTH) ✓ — exact matches.
- The doc note that `PUBLISHED`/`EXPIRED` exist in SQL but **not** in the TS enums: **correct** (they are not in `enums.ts`).

**Agents — jobs** (`services/agent-ai-service/src/modules/job-executor/job-executor.service.ts`)
- Dispatch by `action_type`: `llm_call` → LlmActionService, `webhook` → WebhookActionService, `python_code` → FunctionActionService (stub, empty config), `agent_task` → AgentTaskService ✓; `"function"` is the default ✓.
- Durable consumer `agent-ai-service-consumer` ✓ (see discrepancy #3 regarding the name in service-bus.md).

**Channels — Meta (WhatsApp/Instagram)** (`services/channel-service/src/providers/meta/meta-base.ts`)
- `verifyWebhookSignature`: HMAC-SHA256, prefix `sha256=`, `timingSafeEqual`, header `X-Hub-Signature-256` ✓ (lines 2,67-81).
- Two-stage webhook bridge (api-gateway publishes `webhook_received.v1` without verifying signature → channel-service verifies and publishes `…received.v1`) ✓ (durable `channel-webhook-ingress`).

---

## Conclusion

The documentation in this repo is **unusually faithful to the code** and honest about what is not yet implemented.
The only real corrections needed are: (1) update `overview.md` 200→400, (2) update
`service-bus.md` on the state of tiers (and while at it, review the 256 MB vs 1 GB drift between
services), and (3) fix the durable name in `service-bus.md`. Everything else passed the audit.

*Sources: `DOCS/messaging/{service-bus,claim-check,envelope}.md`, `DOCS/workflows/engine.md`, `DOCS/agents/{execution,memory,jobs}.md`, `DOCS/channels/{telegram-sequence,meta-provider-pattern}.md`, `DOCS/architecture/overview.md`, and the code in `packages/shared/src/`, `services/workflow-service/`, `services/connector-runtime/`, `services/agent-*`, `services/channel-service/`, `packages/database/src/`.*
