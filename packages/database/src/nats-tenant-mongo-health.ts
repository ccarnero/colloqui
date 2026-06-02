import type { NatsConnection } from "nats";
import { checkNats } from "./health-checks";

/**
 * Per-tenant MongoDB connectivity via {@link TenantMongoConnectionManager}-style API.
 */
export interface ITenantMongoConnectivity {
  verifyConnectivity(): Promise<boolean>;
}

export interface INatsTenantMongoHealthInput {
  nc: NatsConnection;
  tenantConnections: ITenantMongoConnectivity;
}

/**
 * Shared health aggregation for services that use NATS + per-tenant MongoDB.
 */
export async function getNatsTenantMongoHealthStatus(
  input: INatsTenantMongoHealthInput,
): Promise<{
  status: "ok" | "degraded";
  nats: boolean;
  mongo: boolean;
}> {
  const [natsOk, mongoOk] = await Promise.all([
    Promise.resolve(checkNats(input.nc)),
    input.tenantConnections.verifyConnectivity(),
  ]);
  return {
    status: natsOk && mongoOk ? "ok" : "degraded",
    nats: natsOk,
    mongo: mongoOk,
  };
}
