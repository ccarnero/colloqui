# Task List — traceability-audit-persist-ids

**Status: ARCHIVED — 2026-06-20 — all tasks complete, tests green (audit-service 66, api-gateway 161, shared 116)**

Cutover pattern (applies to ALL schema tasks): new columns are **nullable**, additions are
**idempotent** (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, additive Mongo index
descriptors). **No historical backfill** — pre-cutover rows keep NULL correlation/causation.
Field sources: `envelope.correlation_id`, `envelope.causation_id`, `envelope.transport?.depth ?? 0`.

Effort scale (fibonacci): 1 / 2 / 3 / 5 / 8.

---

## T1 — Shared: GatewayAuditEvent optional traceability fields
- effort: 1
- depends_on: []
- files: `packages/shared/src/audit.interfaces.ts`
- acceptance_criteria:
  - `GatewayAuditEvent` gains `correlationId?: string | null`, `causationId?: string | null`, `depth?: number | null`.
  - `bun run build` / typecheck of `@yoizen/shared` passes.

## T2 — Shared: Mongo index descriptors for both surfaces
- effort: 2
- depends_on: []
- files: `packages/shared/src/audit-mongo-schema.ts`
- acceptance_criteria:
  - `channel_events` schema gains `idx_ch_evt_correlation` = `{ correlation_id: 1, depth: 1, created_at: 1 }` and `idx_ch_evt_causation` = `{ causation_id: 1 }`.
  - `gateway_audit_events` schema gains `idx_gw_audit_correlation` = `{ correlation_id: 1, depth: 1, created_at: 1 }` and `idx_gw_audit_causation` = `{ causation_id: 1 }`.
  - Index names mirror the prior `events` convention.

## T3 — channel_events Mongo: write path + read mapper + projection type
- effort: 3
- depends_on: [T2]
- files:
  - `services/audit-service/src/modules/channel-audit/channel-audit.mongo.repository.ts`
  - `services/audit-service/src/common/channel-audit-projection.ts`
- acceptance_criteria:
  - Inserted doc includes `correlation_id: envelope.correlation_id ?? null`, `causation_id: envelope.causation_id ?? null`, `depth: envelope.transport?.depth ?? 0`.
  - `IStoredChannelEvent` gains `correlationId/causationId: string | null` and `depth: number | null`.
  - `mapChannelAuditDoc` maps the three fields, NULL-tolerant.

## T4 — channel_events Postgres: DDL + INSERT + SELECT projection
- effort: 3
- depends_on: [T3]
- files:
  - `services/audit-service/src/modules/channel-audit/channel-audit.postgres.repository.ts`
  - `services/audit-service/src/common/channel-audit-projection.ts`
- acceptance_criteria:
  - `ensureChannelEventsTable` runs idempotent `ADD COLUMN IF NOT EXISTS correlation_id TEXT`, `causation_id TEXT`, `depth INTEGER NOT NULL DEFAULT 0`, plus `idx_ch_evt_correlation (correlation_id, depth, created_at)` and `idx_ch_evt_causation (causation_id)` via `CREATE INDEX IF NOT EXISTS`.
  - INSERT writes the three values from the envelope.
  - `CHANNEL_AUDIT_SELECT_PROJECTION` returns `correlation_id AS "correlationId"`, `causation_id AS "causationId"`, `depth`.
  - Re-running ensure on an existing tenant table does not error.

## T5 — gateway_audit_events Mongo: write path + read mapper
- effort: 3
- depends_on: [T1, T2]
- files:
  - `services/audit-service/src/modules/gateway-audit/gateway-audit.mongo.repository.ts`
  - `services/audit-service/src/common/gateway-audit-projection.ts`
- acceptance_criteria:
  - Inserted doc includes `correlation_id: event.correlationId ?? null`, `causation_id: event.causationId ?? null`, `depth: event.depth ?? null`.
  - `mapGatewayAuditDoc` maps the three fields, NULL-tolerant.

## T6 — gateway_audit_events Postgres: DDL + INSERT + projection + sql-row mapper
- effort: 5
- depends_on: [T1, T5]
- files:
  - `services/audit-service/src/modules/gateway-audit/gateway-audit.postgres.repository.ts`
  - `services/audit-service/src/common/gateway-audit-projection.ts`
- acceptance_criteria:
  - `ensureGatewayAuditTable` runs idempotent `ADD COLUMN IF NOT EXISTS correlation_id TEXT`, `causation_id TEXT`, `depth INTEGER` (nullable, no default), plus `idx_gw_audit_correlation (correlation_id, depth, created_at)` and `idx_gw_audit_causation (causation_id)`.
  - INSERT writes `event.correlationId ?? null`, `event.causationId ?? null`, `event.depth ?? null`.
  - `GATEWAY_AUDIT_SELECT_PROJECTION` returns the three aliased columns; `IGatewayAuditSqlRow` and `mapGatewayAuditSqlRow` carry them through.
  - Re-running ensure on an existing tenant table does not error.

## T7 — api-gateway: request augmentation type
- effort: 1
- depends_on: []
- files: `services/api-gateway/src/types/yoizen-request.ts`
- acceptance_criteria:
  - `IYoizenRequest` gains `__correlationId?: string`, `__causationId?: string | null`, `__depth?: number`.

## T8 — api-gateway: webhook publisher stamps correlation onto request
- effort: 3
- depends_on: [T7]
- files:
  - `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts`
  - `services/api-gateway/src/modules/channels/webhooks.controller.ts`
- acceptance_criteria:
  - `IPublishWebhookParams` gains `request: IYoizenRequest` (or `FastifyRequest`-compatible); `webhooks.controller.receive` passes the request.
  - After minting `correlationId = id`, the publisher sets `request.__correlationId = correlationId`, `request.__causationId = null`, `request.__depth = 0`.
  - Publisher return value and existing in-flight/timeout behavior unchanged.

## T9 — api-gateway: interceptor reads correlation into GatewayAuditEvent
- effort: 2
- depends_on: [T1, T8]
- files: `services/api-gateway/src/interceptors/audit.interceptor.ts`
- acceptance_criteria:
  - `publishAudit` sets `correlationId: request.__correlationId ?? null`, `causationId: request.__causationId ?? null`, `depth: request.__depth ?? null` on the event.
  - Non-webhook paths (no stamp) yield `null` for all three — no fabrication, no throw.

## T10 — Tests: channel_events persistence (both backends)
- effort: 3
- depends_on: [T3, T4]
- files: `services/audit-service/test/unit/...` (channel-audit repo/projection specs)
- acceptance_criteria:
  - Mongo repo test: inserting an envelope with `correlation_id`/`causation_id`/`transport.depth` writes the three doc fields; envelope without `transport` defaults depth to `0`.
  - Projection/mapper test: NULL/absent fields map to `null` (depth → `null` when absent in doc), populated fields round-trip.
  - `bun test test/unit` passes for audit-service.

## T11 — Tests: gateway_audit_events persistence + interceptor propagation
- effort: 5
- depends_on: [T5, T6, T9]
- files:
  - `services/audit-service/test/unit/...` (gateway-audit repo/projection specs)
  - `services/api-gateway/test/unit/...` (audit interceptor + webhook publisher specs)
- acceptance_criteria:
  - Gateway projection/mapper tests: populated and NULL correlation/causation/depth round-trip in both Mongo and SQL-row mappers.
  - Interceptor test: a request with `__correlationId` set produces an event with that `correlationId`, `causationId: null`, `depth: 0`; a request without it produces `null` for all three.
  - Publisher test: `publishWebhook` stamps `__correlationId = id`, `__causationId = null`, `__depth = 0` on the passed request.
  - `bun test test/unit` passes for both services.

## T12 — Docs: record cutover + propagation in service CLAUDE.md notes
- effort: 2
- depends_on: [T4, T6, T9]
- files:
  - `services/audit-service/CLAUDE.md`
  - (optional) `services/api-gateway/CLAUDE.md`
- acceptance_criteria:
  - audit-service notes document the new nullable `correlation_id`/`causation_id`/`depth` columns + indexes on `channel_events` and `gateway_audit_events`, the no-backfill cutover, and the index shapes.
  - Note that gateway correlation is populated only on the webhook ingress path, and that `GATEWAY_AUDIT_SKIP_WEBHOOKS=true` suppresses that row.

---

## Suggested execution order
T1, T2, T7 (independent, parallelizable) → T3 → T4 → T5 → T6 → T8 → T9 → T10 → T11 → T12.

## Schema-drift checklist (verify before merge — prior change's #1 risk)
For EACH surface, confirm the field landed in all of:
shared interface (gateway only) · Mongo doc · Mongo index descriptor · Postgres DDL ·
Postgres INSERT · projection SELECT · row/doc mapper(s).
