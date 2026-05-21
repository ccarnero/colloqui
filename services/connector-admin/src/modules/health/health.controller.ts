import { Controller, Get, HttpCode, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { NatsConnection } from "nats";
import {
  NATS_CONNECTION,
  getNatsTenantPostgresHealthStatus,
} from "@yoizen/database";
import { AdapterTenantConnectionManager } from "../../providers/tenant-connection-manager";
import {
  HealthService,
  type ReadinessGate,
  type ServiceModeName,
} from "./health.service";

/**
 * Mode-aware health endpoints for `adapter-service`.
 *
 *   `GET /healthz` (REQ-AST-003 liveness): always 200 while the
 *     process is up. NEVER probes dependencies — kubelet must NOT
 *     restart the pod for transient broker/DB outages.
 *
 *   `GET /readyz` (REQ-AST-003/004/005 readiness): mode-aware gates,
 *     and 503 once SIGTERM is received so kubelet drains traffic.
 *
 *   `GET /health` (legacy, unchanged): aggregate NATS+per-tenant
 *     Postgres status, kept here for backwards-compat with the
 *     pre-Phase-5 manifest still probing `/health`. Phase 5 retires
 *     this path in favour of `/healthz` / `/readyz`.
 *
 * The controller is a thin adapter on top of {@link HealthService} so
 * the gating logic stays unit-testable without a Fastify reply.
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: AdapterTenantConnectionManager,
    private readonly health: HealthService,
  ) {}

  @Get("healthz")
  @HttpCode(200)
  liveness(): { status: "ok" } {
    return this.health.liveness();
  }

  @Get("readyz")
  async readiness(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{
    status: "ok" | "fail";
    mode: ServiceModeName;
    failed: readonly ReadinessGate[];
  }> {
    const result = await this.health.readiness();
    if (!result.ready) {
      reply.status(503);
    }
    return {
      status: result.status,
      mode: result.mode,
      failed: result.failed,
    };
  }

  /**
   * Legacy aggregate health endpoint. Kept for the pre-Phase-5
   * Knative manifest still probing `/health`. Returns the same
   * shape every other NATS+per-tenant-Postgres service exposes via
   * `getNatsTenantPostgresHealthStatus`. Phase 5 will switch the
   * probes to `/healthz` / `/readyz` and this can be deleted.
   */
  @Get("health")
  async check(): Promise<{
    status: "ok" | "degraded";
    nats: boolean;
    postgres: boolean;
  }> {
    return getNatsTenantPostgresHealthStatus({
      nc: this.nc,
      tenantConnections: this.tenantConnections,
    });
  }
}
