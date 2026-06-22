# Archive — `traceability-channel-chain-endpoint`

**Date:** 2026-06-21  
**Status:** VERIFIED AND SHIPPED  
**Verification Result:** PASS — 70/70 tests green, TypeScript clean

---

## Summary

Added a read-only query endpoint to assemble causal-chain trees from persisted `channel_events` rows. The implementation narrows the shared `buildChainTree` assembler to accept a minimal `ChainInputEvent` interface (instead of the broader `IAuditEvent`), enabling reuse across domain models. Completed in five focused tasks: type narrowing, repository method, service method, tests, and documentation updates. No schema migrations, no write-path changes, no NATS configuration.

---

## Files Changed

| File | Change |
|------|--------|
| `services/audit-service/src/modules/audit/build-chain-tree.ts` | Extracted and exported `ChainInputEvent` interface; narrowed `toNode` and `buildChainTree` to accept it (structural compatibility with `IAuditEvent` preserved) |
| `services/audit-service/src/modules/channel-audit/channel-audit.repository.interface.ts` | Added `findByCorrelationId(correlationId: string, tenantId: string): Promise<IStoredChannelEvent[]>` method signature |
| `services/audit-service/src/modules/channel-audit/channel-audit.postgres.repository.ts` | Implemented `findByCorrelationId` with `SELECT ... WHERE correlation_id = $1 ORDER BY created_at ASC` query |
| `services/audit-service/src/modules/channel-audit/channel-audit.mongo.repository.ts` | Implemented `findByCorrelationId` with `collection.find({ correlation_id }).sort({ created_at: 1 })` |
| `services/audit-service/src/common/channel-audit-projection.ts` | Added `toChainInput` pure mapper function to convert `IStoredChannelEvent` → `ChainInputEvent` |
| `services/audit-service/src/modules/channel-audit/channel-audit.service.ts` | Added `getChannelChain(correlationId, tenantId): Promise<ChainTreeResult \| null>` method |
| `services/audit-service/src/modules/channel-audit/channel-audit.controller.ts` | Added `@Get("chain/:correlationId")` route (declared above `@Get(":id")` to prevent route shadowing); returns `ChainTreeResult` or 404 |
| `services/audit-service/test/unit/channel-audit-chain.spec.ts` | New: unit tests for `getChannelChain` (3-node causal chain + empty case) |
| `services/audit-service/test/unit/channel-audit-repo-correlation.spec.ts` | New: unit tests for both repo implementations (`findByCorrelationId` query/sort assertions) |
| `DOCS/messaging/envelope.md` | Added new endpoint description in §8 (queryable chain section) |
| `services/audit-service/CLAUDE.md` | Added API Endpoints table row for `GET /audit/channel-events/chain/:correlationId` |

---

## Acceptance Criteria Met

- ✅ Type narrowing: `ChainInputEvent` extracted and exported; `buildChainTree` narrowed to accept it; existing `IAuditEvent` path remains structurally compatible and compiles unchanged
- ✅ Repository read method: `findByCorrelationId` implemented for both Postgres and Mongo; uses existing composite index `idx_ch_evt_correlation`
- ✅ Mapper: `toChainInput` correctly maps `IStoredChannelEvent` → `ChainInputEvent` with field mappings (`kind` → `type`, `natsSubject` → `subject`, etc.)
- ✅ Service method: `getChannelChain` wires repo query + mapper + `buildChainTree` assembler
- ✅ Controller route: `GET /audit/channel-events/chain/:correlationId` declared above `@Get(":id")` to prevent shadowing; returns `ChainTreeResult` or 404 via `assertFoundOrThrow`
- ✅ Tests: 3-event causal chain test passes; empty result → `null` → 404 path verified; repo query/sort assertions pass for both backends; regression tests confirm `IAuditEvent` path through `buildChainTree` remains green
- ✅ Documentation: endpoint documented in both `DOCS/messaging/envelope.md` and `services/audit-service/CLAUDE.md`

---

## Verification Evidence

- **Tests:** 70/70 green (Vitest + existing regression suite for `build-chain-tree`)
- **TypeScript:** Clean — no `tsc --noEmit` errors across `audit-service`
- **No schema changes:** All columns (`correlation_id`, `causation_id`, `depth`) and indexes already exist from prior change `traceability-audit-persist-ids`
- **No write-path impact:** Only read operations; all existing insert/update methods untouched
- **Rollback:** Simple commit revert (no data migration, no NATS changes, no infrastructure impact)

---

## Key Design Decisions (ADR)

1. **Type narrowing over interface delegation:** Instead of creating a new domain-specific interface hierarchy, we narrowed the existing `buildChainTree` to the minimal `ChainInputEvent` interface it actually requires. This enables reuse without tight coupling and minimizes the surface area. ([Design § Sub-change 1](./design.md#sub-change-1--narrow-buildchaintree-input-type))

2. **Pure mapper function:** The `toChainInput` transformation is a stateless pure function, placed in the projection module alongside existing mappers. This keeps the mapping logic testable and decoupled from service instantiation. ([Design § Sub-change 2](./design.md#sub-change-2--findbyrelationcorrelationid--mapper))

3. **Mirror the `events` pattern:** The new `channel-audit` chain endpoint follows the exact same structure as the existing `audit` chain endpoint (`AuditService.getChain` + `AuditController.getChain`). This ensures consistency, reduces cognitive load, and makes the two paths immediately familiar to readers. ([Design § Sub-change 3](./design.md#sub-change-3--getchannelchain-service-method--controller-route))

---

## Follow-Ups (None Required)

This change is fully self-contained:
- No pending feature flags or phased rollout
- No schema migration hooks
- No dependent feature gates
- No outstanding security audit
- No performance baseline required (query reuses existing composite index)

**Manual verification (post-merge):** Send a Telegram message, capture the `correlation_id` from the webhook audit log, and call `GET /audit/channel-events/chain/:correlationId` to confirm the tree includes both the `received` (inbound) and `sent` (outbound) events.
