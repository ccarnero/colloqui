import { Controller, Get, Inject } from "@nestjs/common";
import type { Client } from "@temporalio/client";
import type { NatsConnection } from "nats";
import {
  NATS_CONNECTION,
  getNatsTenantMongoHealthStatus,
  getNatsTenantPostgresHealthStatus,
  type ITenantMongoConnectivity,
  type ITenantPostgresConnectivity,
} from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { TEMPORAL_CLIENT } from "../../providers/temporal.provider";
import { workflowServiceConfig } from "../../config";
import { WorkflowTenantConnectionManager } from "../../providers/tenant-connection-manager";

/**
 * Aggregates health for Temporal (control plane), NATS (ingestion), and
 * per-tenant storage pools (state). Keeps the Temporal probe specific to
 * this service while reusing the shared NATS+tenant health helpers.
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
    mongo?: boolean;
    postgres?: boolean;
  }> {
    const temporalOk = await this.probeTemporal();

    if (workflowServiceConfig.dbEngine === "mongo") {
      const natsMongo = await getNatsTenantMongoHealthStatus({
        nc: this.nc,
        tenantConnections: this
          .tenantConnections as unknown as ITenantMongoConnectivity,
      });
      const ok = temporalOk && natsMongo.status === "ok";
      return {
        status: ok ? "ok" : "degraded",
        temporal: temporalOk,
        nats: natsMongo.nats,
        mongo: natsMongo.mongo,
      };
    }

    const natsPostgres = await getNatsTenantPostgresHealthStatus({
      nc: this.nc,
      tenantConnections: this
        .tenantConnections as unknown as ITenantPostgresConnectivity,
    });
    const ok = temporalOk && natsPostgres.status === "ok";
    return {
      status: ok ? "ok" : "degraded",
      temporal: temporalOk,
      nats: natsPostgres.nats,
      postgres: natsPostgres.postgres,
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
