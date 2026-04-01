import type { Sql } from "./types";
import type { NatsConnection } from "nats";
import type Redis from "ioredis";
import type * as k8s from "@kubernetes/client-node";

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
 */
export async function checkRedis(redis: Redis): Promise<boolean> {
  try {
    await redis.ping();
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
