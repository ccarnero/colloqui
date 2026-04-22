import { Controller, Get, Inject } from "@nestjs/common";
import type { Client } from "@temporalio/client";
import type { NatsConnection } from "nats";
import {
  NATS_CONNECTION,
  getNatsTenantPostgresHealthStatus,
} from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { TEMPORAL_CLIENT } from "../../providers/temporal.provider";
import { WorkflowTenantConnectionManager } from "../../providers/tenant-connection-manager";

/**
 * Aggregates health for Temporal (control plane), NATS (ingestion), and
 * per-tenant Postgres pools (state). Mirrors the shared
 * `NatsTenantPostgresHealthController` pattern used by audit/metrics
 * while adding the Temporal probe that is specific to this service.
 */
@Controller()
export class HealthController {
  private readonly logger = new PinoLoggerService(HealthController.name);

  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: WorkflowTenantConnectionManager,
  ) {}

  @Get("health")
  async check(): Promise<{
    status: "ok" | "degraded";
    temporal: boolean;
    nats: boolean;
    postgres: boolean;
  }> {
    const [temporalOk, natsPg] = await Promise.all([
      this.probeTemporal(),
      getNatsTenantPostgresHealthStatus({
        nc: this.nc,
        tenantConnections: this.tenantConnections,
      }),
    ]);
    const ok = temporalOk && natsPg.status === "ok";
    return {
      status: ok ? "ok" : "degraded",
      temporal: temporalOk,
      nats: natsPg.nats,
      postgres: natsPg.postgres,
    };
  }

  private async probeTemporal(): Promise<boolean> {
    try {
      await this.temporal.workflowService.getSystemInfo({});
      return true;
    } catch (err) {
      this.logger.warn(
        "Temporal health check failed",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }
}
