# Tenant messaging tiers (descriptive — as built)

Class: descriptive
Summary: How a tenant's messagingTier (free/pro/enterprise) selects the retention window, stream size, message size and replication of its INGRESS-<TENANT> stream.

Shipped 2026-08-01 by `manual-loops/messaging/tenant-messaging-tiers.md`
(T01–T05; the former `DOCS/v_next/tenant-messaging-tiers.md` design left the
staging folder per its rule 5). A tenant's **messaging capacity** — retention
window, stream size, message size, replication of `INGRESS-<TENANT>` — is
chosen by its `messagingTier`: `free` | `pro` | `enterprise`.

## The tier on the tenant

- `messaging_tier` on the tenant record (postgres column + mongo field),
  default `free`; documents/rows created before 2026-08-01 lack the field and
  READ as `free`. Distinct from the database hosting `tier`
  (`shared`/`dedicated`) — never derived from it.
- Assignment surface: `POST /tenants` (`messagingTier` optional) and
  `PATCH /tenants/:name` (`configuration` and/or `messagingTier`, at least
  one; mirrored in the gateway DTOs and the SDK's `client.tenants`).

## Limits and the environment clamp

`TENANT_TIER_LIMITS` (`packages/shared/src/tenant-stream.constants.ts`):

| Tier | `max_age` | `max_bytes` | `max_msg_size` | `num_replicas` |
|---|---|---|---|---|
| `free` | 7d | 1 GiB | 1 MiB | 1 |
| `pro` | 14d | 5 GiB | 1 MiB | 1 |
| `enterprise` | 30d | 20 GiB | 1 MiB | 3 |

The environment CLAMPS effective limits, never re-tiers:
`clampTenantStreamLimits` caps `max_bytes`/`num_replicas` from
`MESSAGING_MAX_BYTES_CEILING`/`MESSAGING_MAX_REPLICAS_CEILING` (unset = no
clamp; set-but-invalid throws). The dev overlay pins 512 MiB / 1 replica —
the measured dev account is 2 GiB on a single-node broker.
`object_store_max_bytes` ships in the table but is NOT wired: claim-check
buckets and DLQ streams stay flat (SPEC decision 5).

## Where tiers apply

- **Creation (provisioning only).** The tenant-provisioning executor resolves
  the tenant's tier, clamps it and passes `options.limits` to
  `ensureTenantIngressStream`. Every other (11) lazy-ensure call site keeps
  the flat `CHANNEL_STREAM_MAX_AGE_NS`/`CHANNEL_STREAM_MAX_BYTES` fallback
  and no-ops once the stream exists (SPEC decision 2 — no per-publish tier
  lookups).
- **Tier change (reconciliation).** `PATCH` with a new `messagingTier`
  updates the live stream FIRST (full existing config + the four limit
  fields), then persists. Refusals: 409 when the clamped `max_bytes` is
  below the stream's current bytes (shrink discards messages; no force flag
  in v1 — note `max_age` shrink is deliberately unguarded and expires older
  messages), and 409 with the broker's reason when the update is rejected.
  A genuinely absent stream (broker 10059 via `isStreamNotFoundError`)
  persists the tier for creation to apply; transport errors persist nothing.
- **Capacity pre-flight.** `checkJetStreamCapacity` compares against
  `max(used, RESERVED)` bytes, reserved derived by `sumReservedStreamBytes`
  over `streams.list` (the client API exposes no `reserved_storage`); an
  existing target stream satisfies the ensure instead of capacity-failing.

## References

- SPEC + per-task Progress log: `manual-loops/messaging/tenant-messaging-tiers.md`
- `packages/shared/src/tenant-stream.constants.ts` — tiers, clamp, capacity check
- `packages/database/src/nats-provider.ts` — `ensureTenantIngressStream`,
  `sumReservedStreamBytes`, `isStreamNotFoundError`
- `services/tenant-service` — record field, DTOs, provisioning executor,
  `reconcileMessagingTier`
