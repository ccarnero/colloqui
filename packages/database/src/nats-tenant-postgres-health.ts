import type { NatsConnection } from "nats";
import { checkNats } from "./health-checks";

/**
 * Per-tenant PostgreSQL connectivity via {@link TenantConnectionManager}-style API.
 */
export interface ITenantPostgresConnectivity {
  verifyConnectivity(): Promise<boolean>;
}

export interface INatsTenantPostgresHealthInput {
  nc: NatsConnection;
  tenantConnections: ITenantPostgresConnectivity;
}

/**
 * Shared health aggregation for services that use NATS + per-tenant PostgreSQL
 */
export async function getNatsTenantPostgresHealthStatus(
  input: INatsTenantPostgresHealthInput,
): Promise<{
  status: "ok" | "degraded";
  nats: boolean;
  postgres: boolean;
}> {
  const [natsOk, postgresOk] = await Promise.all([
    Promise.resolve(checkNats(input.nc)),
    input.tenantConnections.verifyConnectivity(),
  ]);
  return {
    status: natsOk && postgresOk ? "ok" : "degraded",
    nats: natsOk,
    postgres: postgresOk,
  };
}
