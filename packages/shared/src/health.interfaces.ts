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

/** K8s + platform DB (tenant-service). */
export interface ITenantHealthResponse {
  status: HealthStatusLevel;
  kubernetes: IHealthConnectionState;
  postgres: IHealthConnectionState;
}

/** NATS + per-tenant PostgreSQL (audit, metrics, scheduler). */
export interface INatsPostgresHealthResponse {
  status: "ok" | "degraded";
  nats: boolean;
  postgres: boolean;
}

/** NATS + Redis (event-processor, webhook-service). */
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
