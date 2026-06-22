# Archive — traceability-audit-persist-ids

- Status: ARCHIVED
- Archived: 2026-06-20
- Verification: PASS (tests green — audit-service 66, api-gateway 161, shared 116)

---

## What shipped

Full end-to-end traceability ID propagation across all three audit surfaces: `events`
(prior change), `channel_events`, and `gateway_audit_events`. The webhook ingress
path is now fully joinable from gateway HTTP row through channel event through domain
event descendants.

### Scope (Option B — full end-to-end)

- Persist `correlation_id`, `causation_id`, `depth` on **`channel_events`** (Mongo + Postgres).
  Data was already available in `ChannelEnvelope`; this was a pure persistence gap.
- Persist the same three fields on **`gateway_audit_events`** (Mongo + Postgres), including
  indexes matching the prior `events` shape.
- Close the **propagation gap** in the api-gateway: the webhook ingress publisher now stamps
  `__correlationId`, `__causationId`, `__depth` onto `IYoizenRequest`; the audit interceptor
  reads them in its `tap` phase and writes them into the gateway audit event.

### Key decisions (see ADR)

See `.sdd/changes/traceability-audit-persist-ids/adr.md` for full rationale. Summary:

| Decision | Rationale |
|----------|-----------|
| Option B over Option A | Option A would leave gateway columns unused until a follow-up; interceptor wiring belongs in the same change |
| Request-object stamping (`__correlationId` etc.) | Matches the existing `IYoizenRequest` augmentation pattern (`__upstream`, `__rateLimitApplied`); no new DI, no header round-trip, allocation-free |
| No fabrication on non-webhook paths | Only webhook ingress mints a `correlation_id` to join to; inventing one for other HTTP paths would create unjoinable rows |
| `channel.depth` NOT NULL DEFAULT 0; `gateway.depth` nullable | Channel ingress is always root (depth 0 is meaningful); gateway non-webhook has no depth to assert |
| Cutover: nullable columns, no backfill | Mirrors prior `traceability-causal-chain-ingress` change; additive and idempotent schema ops |

### Behavior change

| Path | correlationId | causationId | depth |
|------|---------------|-------------|-------|
| Webhook ingress (`POST /api/webhooks/:channel/:tenantId`) | minted UUID (= request id) | `null` | `0` |
| All other HTTP paths | `null` | `null` | `null` |

`GATEWAY_AUDIT_SKIP_WEBHOOKS=true` suppresses the gateway webhook row entirely; the channel
surface still carries the full chain in that configuration.

---

## Tasks delivered

| Task | Description | Effort |
|------|-------------|--------|
| T1 | `GatewayAuditEvent` gains 3 optional traceability fields | 1 |
| T2 | Mongo index descriptors for channel + gateway surfaces (4 total) | 2 |
| T3 | `channel_events` Mongo: write path + read mapper + projection type | 3 |
| T4 | `channel_events` Postgres: idempotent DDL + INSERT + SELECT | 3 |
| T5 | `gateway_audit_events` Mongo: write path + read mapper | 3 |
| T6 | `gateway_audit_events` Postgres: idempotent DDL + INSERT + full projection | 5 |
| T7 | `IYoizenRequest` gains `__correlationId?`, `__causationId?`, `__depth?` | 1 |
| T8 | Webhook publisher stamps correlation fields on request | 3 |
| T9 | Audit interceptor reads stamped fields into `GatewayAuditEvent` | 2 |
| T10 | Tests: `channel_events` persistence (Mongo + Postgres) | 3 |
| T11 | Tests: `gateway_audit_events` persistence + interceptor propagation | 5 |
| T12 | Docs: cutover + propagation notes in `audit-service/CLAUDE.md` | 2 |

Total effort: 33 points across 12 tasks.

---

## Files touched

**`packages/shared`**
- `src/audit.interfaces.ts` — `GatewayAuditEvent` +3 optional fields
- `src/audit-mongo-schema.ts` — 4 new index descriptors (2 channel, 2 gateway)

**`services/audit-service`**
- `src/modules/channel-audit/channel-audit.mongo.repository.ts` — persist 3 lineage fields
- `src/modules/channel-audit/channel-audit.postgres.repository.ts` — idempotent DDL + INSERT
- `src/common/channel-audit-projection.ts` — `IStoredChannelEvent` type + SELECT + mapper
- `src/modules/gateway-audit/gateway-audit.mongo.repository.ts` — persist 3 fields
- `src/modules/gateway-audit/gateway-audit.postgres.repository.ts` — idempotent DDL + INSERT
- `src/common/gateway-audit-projection.ts` — type, SELECT, `IGatewayAuditSqlRow`, both mappers
- `CLAUDE.md` — cutover + propagation notes

**`services/api-gateway`**
- `src/types/yoizen-request.ts` — `__correlationId?`, `__causationId?`, `__depth?`
- `src/modules/channels/webhook-ingress-publisher.service.ts` — stamps fields; `IPublishWebhookParams.request`
- `src/modules/channels/webhooks.controller.ts` — passes request to publisher
- `src/interceptors/audit.interceptor.ts` — reads stamped fields in `tap`, writes to event

**Tests (new files)**
- `services/audit-service/test/unit/` — channel-audit repo/projection specs
- `services/audit-service/test/unit/` — gateway-audit repo/projection specs
- `services/api-gateway/test/unit/` — audit interceptor spec
- `services/api-gateway/test/unit/` — webhook publisher spec

---

## Verification evidence

- `packages/shared`: 116 tests — all green
- `services/audit-service`: 66 tests — all green
- `services/api-gateway`: 161 tests — all green

---

## Follow-ups (deferred, not blocking)

- Synthetic correlation IDs for scheduler heartbeat and agent-memory events.
- Historical backfill of pre-cutover `channel_events` and `gateway_audit_events` rows.
- Query/filter endpoints and chain-tree builders for the gateway and channel surfaces
  (storage-only in this change — indexes are ready, no read API exposed yet).
