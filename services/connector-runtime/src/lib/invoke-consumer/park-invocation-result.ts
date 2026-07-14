// Port for the invocation result-parking store (`manual-loops/connector-invoke-api.md`
// T05). Declares ONLY the shape so `handle-invoke-request.ts` (facade,
// pending write) and `handle-invoke-requested-message.ts` (consumer,
// completed write) stay free of an `ioredis` import — the concrete
// Redis-backed implementation is `src/activities/_shared/invocation-store.ts`,
// injected by the entrypoints (`http-main.ts`, `invoke-consumer-main.ts`).

import type { InvocationRecord } from "./types";

/**
 * Writes (or overwrites) the parked record for one invocation with a fresh
 * TTL window. MUST be idempotent by `(tenantId, invocationId)` — the
 * consumer calls this again on every JetStream redelivery (crash-before-ack
 * window) and expects the SAME final record, never a duplicate/appended
 * entry (`buildInvocationRedisKey` guarantees a single deterministic key).
 * Never throws for a caller-side reason; Redis/network failures reject the
 * returned promise so the caller (consumer) can decide whether to nak.
 */
export type ParkInvocationResult = (
  record: InvocationRecord,
  ttlSeconds: number
) => Promise<void>;

/**
 * Reads the parked record for one invocation. Resolves `null` on a Redis
 * cache-miss — which, by the tenant-scoped key design, covers "never
 * existed", "expired past its TTL window", AND "belongs to another tenant"
 * uniformly (see `build-invocation-redis-key.ts`'s tenant-scoping note).
 */
export type GetInvocationRecord = (
  tenantId: string,
  invocationId: string
) => Promise<InvocationRecord | null>;
