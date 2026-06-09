import type { Sql } from "./types";
import type { NatsConnection } from "nats";
import type { MongoClient } from "mongodb";
import type * as k8s from "@kubernetes/client-node";

/**
 * Minimal Redis surface for health checks — avoids duplicate `ioredis` typings
 * when the app and this package resolve different physical installs.
 */
export interface RedisPinger {
  ping(): Promise<unknown>;
}

/**
 * Checks PostgreSQL connectivity via `SELECT 1`.
 */
export async function checkPostgres(sql: Sql): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks MongoDB connectivity via `{ ping: 1 }` on the admin database.
 */
export async function checkMongo(client: MongoClient): Promise<boolean> {
  try {
    await client.db("admin").command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks NATS connectivity by verifying the connection is not closed.
 */
export function checkNats(nc: NatsConnection): boolean {
  try {
    return !nc.isClosed();
  } catch {
    return false;
  }
}

/**
 * Checks Redis connectivity via `PING`.
 *
 * A wall-clock timeout prevents indefinite hangs when ioredis Cluster
 * is stuck waiting for slot discovery (e.g. `cluster_state:fail` with
 * zero assigned slots — `CLUSTER SLOTS` returns empty and ioredis
 * queues the command forever).  3 s is generous against the ~0.5 ms
 * in-cluster RTT while still letting the readiness probe recover
 * within a single period.
 */
export async function checkRedis(
  redis: RedisPinger,
  timeoutMs = 3_000,
): Promise<boolean> {
  try {
    await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("redis health timeout")), timeoutMs),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks Kubernetes API connectivity by listing namespaces.
 */
export async function checkK8s(
  coreApi: k8s.CoreV1Api,
): Promise<boolean> {
  try {
    await coreApi.listNamespace({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}
