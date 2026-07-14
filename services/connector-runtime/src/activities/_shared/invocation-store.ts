// Concrete Redis-backed implementation of the `ParkInvocationResult` /
// `GetInvocationRecord` ports (`manual-loops/connector-invoke-api.md` T05) —
// the ONLY place in the invocation-result pipeline where an `ioredis`
// import is allowed, mirroring `redis-client.ts`'s role for the breaker.
//
// Single-key design: both the facade's "pending" write
// (`handle-invoke-request.ts`) and the consumer's "completed" write
// (`handle-invoke-requested-message.ts`) target the SAME key
// (`buildInvocationRedisKey`), each `SET ... EX <ttl>` resetting the full
// TTL window from that write. This is what makes result parking idempotent
// across JetStream redelivery (crash-before-ack): replaying the same
// invocationId overwrites the same key with the same "completed" shape,
// never creating a duplicate record.

import { PinoLoggerService } from "@yoizen/observability";
import { buildInvocationRedisKey } from "../../lib/invoke-consumer/build-invocation-redis-key";
import type {
  GetInvocationRecord,
  ParkInvocationResult,
} from "../../lib/invoke-consumer/park-invocation-result";
import type { InvocationRecord } from "../../lib/invoke-consumer/types";
import { createRedisClient, type RedisClient } from "./redis-client";

const logger = new PinoLoggerService("connector-runtime-invocation-store");

let client: RedisClient | null = null;

function getClient(): RedisClient {
  if (!client) {
    client = createRedisClient();
  }
  return client;
}

export const parkInvocationResult: ParkInvocationResult = async (
  record: InvocationRecord,
  ttlSeconds: number
): Promise<void> => {
  const key = buildInvocationRedisKey(record.tenantId, record.invocationId);
  await getClient().set(key, JSON.stringify(record), "EX", ttlSeconds);
  logger.log(
    `parked invocation record key=${key} status=${record.status} ttlSeconds=${ttlSeconds}`
  );
};

export const getInvocationRecord: GetInvocationRecord = async (
  tenantId: string,
  invocationId: string
): Promise<InvocationRecord | null> => {
  const key = buildInvocationRedisKey(tenantId, invocationId);
  const raw = await getClient().get(key);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as InvocationRecord;
  } catch (cause) {
    logger.warn(
      `invocation record at key=${key} is not valid JSON, treating as expired: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    return null;
  }
};
