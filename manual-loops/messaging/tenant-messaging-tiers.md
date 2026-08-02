# SPEC — tenant messaging tiers: `messagingTier` on the tenant, tier-aware INGRESS creation, clamps + reconciliation

> Task queue for the `/manual-loop` discipline. One task at a time, gated by
> tests and dual review, one commit per green checkpoint.
> Formalizes `DOCS/v_next/tenant-messaging-tiers.md` (FUTURE design, authored
> from docs-consistency T07 finding 8, adjudicated 2026-07-31).
> Origin of authorization: Christian, 2026-08-01 — "arranca con el 2 y frena
> para check y commit si sale todo bien, siempre ejecuta el tests de
> integracion". That ruling approves running this effort with per-task
> commit checkpoints and a mandatory integration test at every checkpoint.
> Engram topic: `messaging/tenant-messaging-tiers`.

## Goal

A tenant's messaging capacity (retention, stream size, message size,
replication) is chosen by its `messagingTier` — `free` | `pro` | `enterprise`
(`TenantTier`, `packages/shared/src/tenant-stream.constants.ts:1`) — applied to
`INGRESS-<TENANT>` at provisioning time and reconciled on tier change, instead
of today's flat `CHANNEL_STREAM_MAX_AGE_NS`/`CHANNEL_STREAM_MAX_BYTES`.

## User decisions (recorded design calls — the v_next §5 open questions)

1. **Tier is a property of the TENANT** (`messagingTier` on the tenant record,
   default `free`; absent field reads as `free`, no migration). The
   environment does NOT change the tier — it CLAMPS the effective limits
   (decision 3). Distinct from the database `tier` (`shared`/`dedicated`);
   never derived from it.
2. **Only the PROVISIONING path is tier-aware.** The other 9
   `ensureTenantIngressStream` call sites sit on publish hot paths and keep
   the flat-config lazy-ensure fallback untouched: post-provisioning they are
   `STREAM_NAME_IN_USE` no-ops, and a pre-provisioning race is healed by the
   tier-change/provisioning reconciliation (T04) — not by per-publish tier
   lookups. No cached cross-service resolver in v1.
3. **Environment clamp, not per-environment tiers.** Effective limits =
   `clampTenantStreamLimits(TENANT_TIER_LIMITS[tier], env ceilings)`;
   ceilings come from env vars (`MESSAGING_MAX_BYTES_CEILING`,
   `MESSAGING_MAX_REPLICAS_CEILING`), unset = no clamp. Dev overlay sets
   512 MiB / 1 replica so `pro`/`enterprise` fit the measured 2 GiB dev
   account (v_next prerequisite 3).
4. **Downgrades are non-destructive or refused.** Reconciliation uses
   `streams.update`; a shrink of `max_bytes` below the stream's CURRENT bytes
   (or `max_age` below its config) under `retention: limits` discards
   messages, so the service REFUSES (HTTP 409) any tier change whose clamped
   `max_bytes` is below current usage. No force flag in v1 (out of scope).
5. **Object-store (claim-check) and DLQ limits stay flat** in v1. Recorded,
   not wired: `object_store_max_bytes` keeps shipping in `TENANT_TIER_LIMITS`
   unused.

## Constraints (apply to every task)

- Wire compatibility: existing tenants keep working with absent
  `messagingTier` (⇒ `free` at read); no existing stream is touched except
  through the explicit T04 reconciliation path.
- `ensureTenantIngressStream`'s default (optionless) behavior is byte-for-byte
  unchanged — 9 hot-path call sites must not gain lookups or round-trips.
- Every checkpoint: unit gates + `./scripts/e2e/http-workflow.sh` (cluster
  integration test) green before commit. The CRM demo smoke
  (`demos/crm-support-telegram/run.sh`) runs at the FINAL checkpoint (T05) as
  the provisioning-path integration proof.
- Dual adversarial review (2× APPROVED) before each commit.

## Gates (per checkpoint)

```
G1  cd packages/shared && bun test && bunx tsc --noEmit
G2  cd packages/database && bun test
G4  cd services/tenant-service && bun run build && bun run test
G6b ./rebuild-redeploy.sh <touched-svc> dev && ./scripts/e2e/http-workflow.sh
```

## Task queue

### T01 — `messagingTier` on the tenant record + assignment surface
- `packages/shared/src/platform-mongo-schema.ts`: `messagingTier` in the
  tenant catalog document (validator + default note), index not required.
- tenant-service: `CreateTenantDto` optional `messagingTier` (default
  `free`), `UpdateTenantDto` optional `messagingTier`, `ITenantDetail`
  exposes it; `tenants.service.ts` persists/reads with absent⇒`free`.
- Accept: unit tests — create with/without tier, read defaults, update
  persists; invalid tier rejected 400.

### T02 — tier-aware creation at provisioning
- `packages/shared`: `clampTenantStreamLimits(limits, ceilings)` +
  env-ceiling reader (decision 3).
- `packages/database` `ensureTenantIngressStream`: optional
  `options.limits?: TenantStreamLimits` (caller-resolved; helper stays
  lookup-free). When provided, `streams.add` uses them (max_age, max_bytes,
  max_msg_size, num_replicas) instead of the flat constants.
- tenant-provisioning-executor: resolve the tenant's `messagingTier`,
  compose `TENANT_TIER_LIMITS[tier]` → clamp → pass as `options.limits`.
- Accept: unit tests — options.limits applied verbatim on add; omitted ⇒
  flat config identical to today (pinned); executor passes clamped limits.

### T03 — capacity-check honesty
- `checkJetStreamCapacity` compares against RESERVED storage
  (`accountInfo.reserved_storage` when available), not just used bytes
  (v_next prerequisite 3 refinement); callers unchanged.
- Accept: unit test reproducing the under-count (reserved > used) that
  passed before and fails now without the fix.

### T04 — tier-change reconciliation
- tenant-service `updateTenant`: on `messagingTier` change, fetch
  `INGRESS-<TENANT>` info; compute clamped target limits;
  refuse (409, message with numbers) if target `max_bytes` < current stream
  `state.bytes`; else `streams.update` and persist the new tier.
  Stream absent ⇒ persist tier only (creation will apply it).
- Accept: unit tests — grow applied, shrink-below-usage refused 409,
  stream-absent persists, tier unchanged ⇒ no jsm call.

### T05 — live validation + docs
- Dev overlay: ceilings env vars on tenant-service.
- Live: create a tenant with `messagingTier: pro` in dev; verify via
  `/jsz?streams=1&config=1` the clamped config; tier change grow + refused
  shrink live; cluster e2e + CRM demo smoke green.
- `DOCS/v_next/tenant-messaging-tiers.md` → moved/annotated as SHIPPED
  (v_next README rules); tenant docs updated.

## Out of scope (explicit)
- Claim-check bucket + DLQ tiering (decision 5).
- Force-downgrade / message-discarding shrink (decision 4).
- Cross-service cached tier resolver; making the 9 lazy call sites
  tier-aware (decision 2).
- Billing/entitlement enforcement of tiers.

## Progress

### T01 — 2026-08-01

`messaging_tier` shipped end-to-end on the tenant record: shared
`TENANT_TIERS`/`isTenantTier`/`DEFAULT_TENANT_MESSAGING_TIER`; postgres DDL
(column + check constraint INTERPOLATED from the shared constants); both
repositories with absent⇒free / invalid⇒throw parity + `updateMessagingTier`;
DTOs (Update now both-optional, service 400s an empty body); detail/summary/
accepted expose it; api-gateway mirror DTOs updated (the mirror invariant
would otherwise 400 the new field — caught by review round 1). Deviations
recorded: `platform-mongo-schema.ts` got a documented note instead of a
validator (the file is index-only by type); SDK tenant types
(`sdk/src/resources/tenants/types.ts`) intentionally lag until T05's docs/SDK
sweep — its "PATCH requires configuration" comment is stale as of this task.
Tests: dto validation spec (invalid tier rejected), repository legacy-doc +
invalid-in-DB specs, DDL pins, service create/update/400 specs.
Gates: shared 365 + tsc; tenant-service build + 89 unit; api-gateway build +
314 unit; both services rebuilt in dev; cluster e2e full pass ×2.
Dual review: round 1 2× REJECTED (gateway mirror, missing acceptance tests,
DDL literals, schema note) — all fixed; round 2 2× APPROVED.

### T02 — 2026-08-01

Tier-aware INGRESS creation at provisioning only (decision 2): shared
`clampTenantStreamLimits` + `readMessagingCeilingsFromEnv`
(`MESSAGING_MAX_BYTES_CEILING`/`MESSAGING_MAX_REPLICAS_CEILING`, absent ⇒ no
clamp, set-but-invalid ⇒ throw → provisioning fails loud with the reason);
`ensureTenantIngressStream` gains caller-resolved `options.limits` (flat path
byte-for-byte pinned with toStrictEqual; capacity pre-flight uses the tier's
bytes); executor resolves tier → limits → clamp and the handler threads
`row.messaging_tier` (pinned by calledWith in the handler spec — the only
link between persisted tier and creation).

KNOWN INTERIM WINDOW (T02→T05): no environment sets the `MESSAGING_*`
ceilings yet (T05 ships the dev overlay). Until then a pro/enterprise tenant
provisioned in dev requests 5/20 GiB (and enterprise 3 replicas) against the
measured 2 GiB single-node account — `streams.add` fails, the handler burns
its redeliveries and the tenant lands provisioning-FAILED (terminal;
delete-and-recreate). Free tenants (the only kind that exists today)
unaffected. Flagged at the executor clamp site too.

Gates: shared 371 + tsc, database 128, tenant-service build + 91, dev
rebuild + cluster e2e pass. Dual review: round 1 2× REJECTED (stale
TENANT_TIER_LIMITS/"single creator"/capacity-error doc comments now false,
handler pass-through unasserted, toEqual-vs-toStrictEqual pin, unrecorded
interim window) — all fixed; round 2 2× APPROVED. Reviewer nit for T05's
docs pass: decision 2 / the `limits` option doc say "9" lazy call sites, a
fresh grep counts 11 across 8 services.

### T03 — 2026-08-01

Capacity-check honesty. DEVIATION from the task text: the nats.js client
API exposes NO `reserved_storage` field (verified against the pinned
`nats` typings; the server's wire response carries it, but reading it
untyped off `getAccountInfo()` was rejected in favor of a typed
derivation) — new `sumReservedStreamBytes(jsm, targetName?)` sums
`config.max_bytes > 0` over `jsm.streams.list()`, and
`checkJetStreamCapacity` gains an optional `reservedBytes`
(`available = limit − max(used, reserved)`; `max`, not sum, because bounded
usage lives inside its reservation — doc + shared pin added). The scan is
skipped on unlimited accounts. Callers unchanged per the task text: the
provisioning executor still does not pass `checkCapacity` (broker
rejections surface as provisioning-FAILED, the T02 interim contract).

ROUND-1 REVIEW CATCH (real bug in the first implementation): the scan
counted the tenant's OWN stream, so on a reservation-full account every
pod restart made the idempotent re-ensure throw capacity BEFORE reaching
the STREAM_NAME_IN_USE branch — permanent 503 for existing tenants. Fixed:
the scan detects the target stream and treats the ensure as satisfied
(cache seeded, no add); regression test pins the exact scenario including
the no-second-round-trip follow-up.

Gates: shared 373 + tsc, database 131 + tsc, agent-admin/agent-memory at
their pre-existing infra baselines, both rebuilt in dev, cluster e2e
green. Dual review: round 1 2× REJECTED (self-inclusion bug, unrecorded
deviation) — fixed; round 2 2× APPROVED (their two non-blocking notes —
unlimited-account scan-skip pin + stale mock type — folded in before
commit).

### T04 — 2026-08-01

Tier-change reconciliation in tenant-service `updateTenant`:
`reconcileMessagingTier` runs BEFORE the persist (a failed persist retries
into a harmless re-update; a failed reconcile never leaves a persisted tier
the stream missed). Absent stream (broker 10059, discriminated by the new
shared `isStreamNotFoundError` in `@yoizen/database`, mirroring
`isStreamNameInUseError`) ⇒ persist only, creation applies; any OTHER
`streams.info` failure rethrows and nothing persists (round-1 catch: the
first cut's catch-all read transport errors as "absent" and drifted state).
Shrink guard refuses 409 when clamped `max_bytes` < current `state.bytes`
(decision 4; `max_age` shrink DELIBERATELY unguarded per its bytes-only
criterion — documented at the guard, flagged for the T05 docs pass).
Broker-rejected updates map to 409 with the broker's reason, not a generic
500. Unchanged tier ⇒ zero stream/persist work.

KNOWN INTERIM (same T02→T05 window): with dev ceilings unset, a live GROW
in dev asks for limits the 2 GiB account can't grant — now surfaced as the
mapped 409, tier not persisted. Both-fields PATCH persists configuration
first, so a tier 409 leaves the configuration change applied (sequential
semantics, pre-existing from T01).

Gates: database 135 + tsc (includes a dedicated `isStreamNotFoundError`
spec pinning the structured 10059 branch, the message fallback and the
transport-error negative — added on the reviewers' shared note),
tenant-service build + 96 unit, rebuilt in dev, cluster e2e green.
Dual review: round 1 2× REJECTED (transport-error catch-all, missing
Progress entry, unmapped broker rejection) — all fixed; round 2
2× APPROVED.
