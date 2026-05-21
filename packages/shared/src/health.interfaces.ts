/**
 * Standard health payloads returned by platform services.
 */

export type IHealthConnectionState = "connected" | "disconnected";

export type HealthStatusLevel = "ok" | "degraded" | "error";

export type IHealthAggregateStatus = "ok" | "degraded";

/** Auth service: Postgres + Redis. */
export interface IAuthServiceHealthResponse {
  status: IHealthAggregateStatus;
  postgres: IHealthConnectionState;
  redis: IHealthConnectionState;
}

/** Cache service: Redis only. */
export interface ICacheServiceHealthResponse {
  status: IHealthAggregateStatus;
  redis: IHealthConnectionState;
}

/** Downstream GET /health JSON (permissive). */
export type IGatewayDownstreamHealthBody = Record<string, unknown>;

export type IGatewayDownstreamHealth =
  | IGatewayDownstreamHealthBody
  | "unreachable";

/** API gateway core: NATS + Redis + downstream map. */
export interface IGatewayCoreHealthResponse {
  status: IHealthAggregateStatus;
  nats: IHealthConnectionState;
  redis: IHealthConnectionState;
  services: Record<string, IGatewayDownstreamHealth>;
}

export type IApiGatewayHealthResponse = IGatewayCoreHealthResponse;

/**
 * Provisioning consumer state (tenant-service). `running` means the
 * JetStream pull-iterator supervisor is alive and bound; `stopped`
 * means the supervisor has exited or never started; `degraded` means
 * it is currently in the error-backoff path between iterator failures.
 *
 * Exposed in `/health` so Knative liveness can restart the pod when
 * the consumer is dead even though Fastify is still serving HTTP.
 */
export type ITenantProvisionerState = "running" | "degraded" | "stopped";

/** K8s + platform DB + provisioning consumer (tenant-service). */
export interface ITenantHealthResponse {
  status: HealthStatusLevel;
  kubernetes: IHealthConnectionState;
  postgres: IHealthConnectionState;
  /**
   * Provisioning consumer (`PLATFORM_TENANTS / tenant-provisioner`).
   * Optional for backward compatibility with older tenant-service
   * builds that didn't surface this field — clients should treat
   * `undefined` as "unknown" rather than "running".
   */
  provisioner?: ITenantProvisionerState;
}

/** NATS + per-tenant PostgreSQL (audit, metrics, scheduler). */
export interface INatsPostgresHealthResponse {
  status: "ok" | "degraded";
  nats: boolean;
  postgres: boolean;
}

/** NATS + Redis (channel-service worker, etc.). */
export interface INatsRedisHealthResponse {
  status: "ok" | "degraded";
  nats: boolean;
  redis: boolean;
}

/** YoizenClaw admin DB check. */
export interface IYoizenClawHealthResponse {
  status: "ok" | "error";
  timestamp: string;
  checks: { database: "up" | "down" };
}
