# Traceability Changes — Handoff for the Team

Summary of what was done in the working session on end-to-end message traceability, ready to share with the other dev. Date: 2026-06-20. Stack: NestJS/Bun, NATS JetStream, Postgres+Mongo per tenant, OTel.

> **Status:** implemented, with green tests, **committed** (all four P0 changes are archived in `.sdd/changes/`). See "Still Pending" for optional items.

---

## TL;DR

**2 changes** were implemented via the SDD flow (full artifacts in `.sdd/changes/`):

1. **`traceability-causal-chain-ingress`** — the audit-service now **persists** `correlation_id` / `causation_id` / `depth` in the `events` store and exposes **chain query endpoints**.
2. **`traceability-audit-persist-ids`** — same 3 fields persisted in `channel_events` and `gateway_audit_events`, **+ propagation to the gateway interceptor** (Option B).

**Tests:** shared 116 ✅ · audit-service 66 ✅ · api-gateway 161 ✅.

**✅ The two remaining items (root ingress bug and `channel_events` chain endpoint) are already resolved and shipped** (see "Final Status (post full implementation)").

---

## What Each Change Shipped

### 1. `traceability-causal-chain-ingress` (audit-service)
- Columns/indexes `correlation_id`, `causation_id`, `depth` in `events` (idempotent Postgres DDL + 2 Mongo indexes).
- Both repos (PG+Mongo) write the 3 top-level fields from 2026-06-20 onward.
- **New endpoints:**
  - `GET /audit/events?correlation_id=<id>` — flat list of the correlation group (tenant-scoped).
  - `GET /audit/events/chain/:correlationId` — **causal tree** assembled from the full flow (pure function `buildChainTree`, `MAX_CHAIN_NODES` cap, orphan/synthetic-root handling; 8 test cases).
- Decision: the **lineage backbone is `correlation_id` + `causation_id` + `depth`**. `traceid` is NOT used for lineage (unreliable due to D9); it is stored in `metadata.traceid` for reference only.
- Official docs: `DOCS/messaging/envelope.md §8` updated by this change.

### 2. `traceability-audit-persist-ids` (audit-service + api-gateway) — **Option B**
- `correlation_id`/`causation_id`/`depth` persisted in `channel_events` and `gateway_audit_events` (Mongo+Postgres, indexes included).
- **Propagation in api-gateway:** the webhook ingress publisher stamps `__correlationId`/`__causationId`/`__depth` onto `IYoizenRequest`; the `audit.interceptor` reads them in the `tap` and writes them to the gateway audit row. → HTTP gateway rows become joinable.
- Does not fabricate IDs on non-webhook paths (they remain null). `GATEWAY_AUDIT_SKIP_WEBHOOKS=true` suppresses the gateway webhook row.
- 12 tasks, 33 effort points.

(File-by-file detail in `.sdd/changes/<change>/archive.md`.)

---

## Final Status (post full implementation)

1. **Option B was chosen and is shipped.** The `traceability-audit-persist-ids` change threads the correlation into the gateway interceptor (Option B): `yoizen-request.ts`, `webhook-ingress-publisher.service.ts`, `webhooks.controller.ts`, `audit.interceptor.ts`. Intentional; committed.

2. **✅ The root ingress bug is FIXED** (git `6292520`). `channel-service` now threads `correlation_id`/`causation_id`/`depth` from the `WebhookIngressEnvelope` through `processInbound` → `createChannelEnvelope` (`ingress.service.ts:116-164`). The canonical `ChannelEnvelope` **inherits** the `correlation_id` from the webhook. Consequence:
   - A `/chain/:correlationId` query using the **provider webhook's** correlation returns the webhook event + the canonical message + all its descendants under the same `correlation_id`.
   - End-to-end traceability from the provider webhook **works completely**.

3. **✅ Chain endpoint for `channel_events`: SHIPPED.** `GET /audit/channel-events/chain/:correlationId` is in production (`channel-audit.controller.ts:35`), reusing `buildChainTree`. See `.sdd/changes/traceability-channel-chain-endpoint/archive.md`.

---

## Still Pending

- **`traceability-depth-and-traceid`** (P1/P2, optional/low priority) — `DepthTracker` uses `>=` vs `>`; and the `traceid=randomUUID()` fallback (D9).
- Historical backfill — **intentionally discarded** (cutover; causation is unrecoverable). Do not do this unless required for compliance.

---

## Deploy + Data

1. **Committed.** All four P0 changes are committed (git `6292520` and associated commits).
2. **Data (you're in PoC):** cutover without backfill. Clear the audit tables — re-bootstrap the dev cluster (`./bootstrap-orbstack-osx.sh` + `./setup-tenant.sh`) or `DROP TABLE` on `events`/`channel_events`/`gateway_audit_events` + restart the `audit-service` pod.
3. **Verify** post-deploy: send a message through the http channel and hit `GET /audit/events/chain/:correlationId` or `GET /audit/channel-events/chain/:correlationId` — you will see the full tree from webhook to descendants under the same `correlation_id`.

---

## Where Everything Lives

- Formal change records: `.sdd/changes/<change>/` (`explore`/`design`/`adr`/`tasks`/`archive`).
- Code: committed on `main` (`services/audit-service`, `services/api-gateway`, `packages/shared`; incl. `6292520`).
- Official docs: `DOCS/messaging/envelope.md`, `services/audit-service/CLAUDE.md`.
- Analysis and context: `cowork/` folder (see `cowork/INDEX.md`).
