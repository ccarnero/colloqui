import { Inject, Injectable } from "@nestjs/common";
import type * as k8s from "@kubernetes/client-node";
import type { Sql } from "@yoizen/database";
import { checkK8s, checkPostgres } from "@yoizen/database";
import { K8S_CORE_API } from "../../providers/kubernetes.provider";
import { PLATFORM_POSTGRES_SQL } from "../../providers/platform-postgres.provider";
import type { ITenantHealthResponse } from "@yoizen/shared";

/**
 * Probes Kubernetes and platform PostgreSQL for readiness reporting.
 */
@Injectable()
export class HealthService {
  constructor(
    @Inject(K8S_CORE_API) private readonly k8sApi: k8s.CoreV1Api,
    @Inject(PLATFORM_POSTGRES_SQL) private readonly sql: Sql,
  ) {}

  /**
   * @returns Aggregated connectivity for `/health`.
   */
  async getStatus(): Promise<ITenantHealthResponse> {
    const [k8sOk, pgOk] = await Promise.all([
      checkK8s(this.k8sApi),
      checkPostgres(this.sql),
    ]);

    const allOk = k8sOk && pgOk;
    return {
      status: allOk ? "ok" : "degraded",
      kubernetes: k8sOk ? "connected" : "disconnected",
      postgres: pgOk ? "connected" : "disconnected",
    };
  }
}
