# Tenant messaging tiers (FUTURE)

**Status: FUTURE design — not implemented.** See [`README.md`](README.md) for what
that means. Nothing here describes current behaviour; the "Current state"
section below does, and is marked as such.

> Citation discipline: `scripts/checks/doc-code-guards.sh` does NOT validate this
> folder (README rule 3), so nothing mechanically catches a stale `file:line`
> here — review is the only net. Every anchor below was resolved against the
> file when written; re-resolve them when you touch the cited code.

Agreed direction: a tenant's **messaging capacity** (retention window, stream
size, message size, replication) is chosen by a tier — `free`, `pro` or
`enterprise` — instead of one flat setting for everyone.

## 1. Not the same axis as the database tier

Two independent "tier" concepts exist. Conflating them is the first mistake this
document exists to prevent.

| | Messaging tier (THIS doc) | Database hosting tier (today, real) |
|---|---|---|
| Type | `TenantTier` = `free` \| `pro` \| `enterprise` (`packages/shared/src/tenant-stream.constants.ts:1`) | `TenantDatabaseTierValue` = `shared` \| `dedicated` (`packages/shared/src/tenant-database-tier.ts:1-7`) |
| Governs | JetStream `INGRESS-<TENANT>` limits | Postgres placement: logical DB on the shared CNPG cluster vs a dedicated StatefulSet |
| Stored on the tenant | **No** — nothing assigns one | **Yes** — `tier` on the tenant record (`services/tenant-service/src/modules/tenants/tenants.service.ts:54`), default `shared` (`platform-mongo-schema.ts:138`) |
| Status | future (this doc) | shipped |

A tenant on the `shared` database tier could be on any messaging tier, and vice
versa. Do not derive one from the other.

## 2. The target limits

From `TENANT_TIER_LIMITS` (`packages/shared/src/tenant-stream.constants.ts:34-56`),
which already exists in code as the reserved definition:

| Tier | `max_age` | `max_bytes` | `max_msg_size` | `num_replicas` | `object_store_max_bytes` |
|---|---|---|---|---|---|
| `free` | 7 days | 1 GiB | 1 MiB | 1 | 512 MiB |
| `pro` | 14 days | 5 GiB | 1 MiB | 1 | 2 GiB |
| `enterprise` | 30 days | 20 GiB | 1 MiB | 3 | 5 GiB |

Applied to the per-tenant ingress stream `INGRESS-<TENANT>` (subjects
`evt.<tenant>.>`), composed by `buildTenantStreamConfig(tenantId, tier)`
(`tenant-stream.constants.ts:73-83`).

## 3. Current state (descriptive — this part IS as-built)

- **One flat config for every tenant.** `ensureTenantIngressStream`
  (`packages/database/src/nats-provider.ts`) creates `INGRESS-<TENANT>` with
  `max_age` = `CHANNEL_STREAM_MAX_AGE_NS` (7 days) and `max_bytes` =
  `CHANNEL_STREAM_MAX_BYTES` (256 MiB, `channel.constants.ts:17-18`). It sets
  neither `max_msg_size` nor `num_replicas`, so the server defaults apply.
- **It is create-only.** The helper issues `streams.add` and treats
  `STREAM_NAME_IN_USE` (10058) as success; its contract explicitly states it
  "makes no claim about reconciling drifted stream config". No code path updates
  an existing tenant stream's limits.
- **`TENANT_TIER_LIMITS` has no live consumer.** Until 2026-07-31 agent-admin and
  agent-memory called `buildTenantStreamConfig(tenantId, "free")` — with the
  tier **hardcoded** and a warning logged, because no tenant record carries a
  `TenantTier`. Both now delegate to the shared helper (see prerequisite 5), so
  the constants are reserved for this design and referenced by nothing else.
- **Live evidence** (dev cluster, `nats-0`, `/jsz?streams=1&config=1`,
  2026-07-31):

  ```
  INGRESS-ACME   max_age=604800000000000 (7d)   max_bytes=268435456 (256 MiB)
                 max_msg_size=-1  num_replicas=1  retention=limits
                 subjects=[evt.acme.>]          8956 msgs / 14.7 MB
  account:       max_storage=2 GiB   in use ~82 MiB   reserved ~896 MiB
  ```

  Those are exactly the flat values — not `free` (which would be 1 GiB with a
  1 MiB message cap).

## 4. Prerequisites to activate

1. **A `TenantTier` on the tenant record, plus an assignment surface.** No field
   exists today (§1). Needs: the field, a default, an admin/API way to set it,
   and a decision on what happens to existing tenants (presumably `free`).
2. **A tier resolution path to the creation sites.** `ensureTenantIngressStream`
   takes `(jsm, tenantId)` and has **10 production call sites** across 7
   services, none of which has a tier in scope:
   - `services/tenant-service/src/modules/provisioning/tenant-provisioning-executor.service.ts:110`
   - `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts:156`
   - `services/channel-service/src/modules/ingress/ingress.service.ts:133`
   - `services/channel-service/src/modules/egress/egress.service.ts:161`
   - `services/ai-agent-gateway/src/modules/executions/executions.service.ts:118` and `:352`
   - `services/ai-agent-gateway/src/providers/nats.provider.ts:38`
   - `services/registry-service/src/modules/services/service-events.publisher.ts:309`
   - `services/provisioning-service/src/modules/secrets/infrastructure/secret-audit.publisher.ts:212`
   - `services/provisioning-service/src/modules/apply/infrastructure/apply-events.publisher.ts:248`

   Most sit on publish hot paths, so a per-publish lookup is not acceptable —
   this needs a cached resolver, or the tier must travel with provisioning and
   the other sites must stop creating streams at all.
3. **A cluster capacity plan.** Today's dev JetStream account allows **2 GiB**
   total (`max_storage`, measured above). A single `pro` stream (5 GiB) or
   `enterprise` stream (20 GiB) exceeds the entire account; `enterprise` also
   asks for `num_replicas: 3` against a single-node NATS. Even `free` at 1 GiB
   per tenant exhausts the account at 3 tenants. Activating tiers therefore
   requires sizing the cluster first, and per-environment tier ceilings.
   Related refinement: `checkJetStreamCapacity`
   (`tenant-stream.constants.ts:101-133`) compares the request against
   `storage` (bytes **used**), not `reserved_storage`, so it can pass while NATS
   still rejects — it under-counts already-reserved stream capacity.
4. **A reconciliation strategy for existing streams.** Creation-time tiers only
   affect NEW tenants; every stream that already exists keeps its flat limits
   forever, because the helper never updates. Applying a tier to a live stream
   means `streams.update`, and under `retention: limits` **shrinking `max_bytes`
   or `max_age` discards messages** (oldest first) to fit the new bound. A
   downgrade is therefore data-destructive and needs an explicit policy:
   who may downgrade, with what notice, and whether the platform refuses shrink
   below current usage.
5. **A single stream creator.** ✅ **Delivered 2026-07-31** (envelope-drift
   post-loop item 6). `INGRESS-<TENANT>` previously had two creators with
   different configs — the shared helper (flat) and agent-admin/agent-memory
   (free-tier) — and the winner was whichever service touched a new tenant
   first. Both services now delegate to `ensureTenantIngressStream`, so there is
   exactly one creation config to make tier-aware when the work above lands.

## 5. Open questions for the design round

- Is the tier a property of the tenant, or of the environment × tenant? A `pro`
  tenant in a small staging cluster cannot get `pro` limits.
- Do the object-store (claim-check) limits move with the messaging tier?
  `object_store_max_bytes` is in the table, but the bucket is created separately
  with `CLAIM_CHECK_BUCKET_MAX_BYTES` (512 MiB) — which happens to equal the
  `free` value.
- Does the DLQ stream (`DLQ-<tenant>`) get tiered limits too, or stay flat?

## References

- `packages/shared/src/tenant-stream.constants.ts` — `TenantTier`,
  `TENANT_TIER_LIMITS`, `buildTenantStreamConfig`, `checkJetStreamCapacity`
- `packages/database/src/nats-provider.ts` — `ensureTenantIngressStream`, the
  single creator
- `packages/shared/src/channel.constants.ts:17-18` — the flat limits in force today
- `packages/shared/src/tenant-database-tier.ts` — the unrelated database tier
- `manual-loops/architecture/docs-consistency.md` — T07 finding 8, which this
  document formalizes
