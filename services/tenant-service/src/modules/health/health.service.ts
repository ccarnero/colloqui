import { Inject, Injectable } from "@nestjs/common";
import type * as k8s from "@kubernetes/client-node";
import type { Sql } from "@yoizen/database";
import { checkK8s, checkPostgres } from "@yoizen/database";
import { K8S_CORE_API } from "../../providers/kubernetes.provider";
import { PLATFORM_POSTGRES_SQL } from "../../providers/platform-postgres.provider";
import type {
  ITenantHealthResponse,
  ITenantProvisionerState,
} from "@yoizen/shared";
import { TenantProvisionConsumerService } from "../provisioning/tenant-provision-consumer.service";

/**
 * Probes Kubernetes, platform PostgreSQL, and the JetStream provisioning
 * consumer for readiness reporting.
 *
 * Aggregation rules (chosen to keep Knative liveness from restart-
 * looping the fleet during an infra outage):
 *  - Kubernetes API or platform PostgreSQL unreachable → `degraded`
 *    (HTTP 200 — the pod is fine, the upstream is the problem;
 *    restarting wouldn't fix anything and would amplify the outage).
 *  - Provisioning consumer `stopped` → `error` (HTTP 503 — the
 *    in-process supervisor already exhausted self-recovery, so the
 *    only remaining option is for Knative to recycle the pod and
 *    rerun `onModuleInit`. This is the failure mode that previously
 *    left tenants stuck in `provisioning_status: pending` forever
 *    without any external signal — see RCA in PR description).
 *  - Provisioning consumer `degraded` (in error backoff) → `degraded`
 *    (HTTP 200 — supervisor is actively retrying with exponential
 *    backoff; restarting would just discard reattach progress).
 *  - Otherwise → `ok`.
 */
@Injectable()
export class HealthService {
  constructor(
    @Inject(K8S_CORE_API) private readonly k8sApi: k8s.CoreV1Api,
    @Inject(PLATFORM_POSTGRES_SQL) private readonly sql: Sql,
    private readonly provisionConsumer: TenantProvisionConsumerService,
  ) {}

  /**
   * @returns Aggregated connectivity for `/health`.
   */
  async getStatus(): Promise<ITenantHealthResponse> {
    const [k8sOk, pgOk] = await Promise.all([
      checkK8s(this.k8sApi),
      checkPostgres(this.sql),
    ]);
    const provisioner: ITenantProvisionerState =
      this.provisionConsumer.getProvisionerState();

    const status = aggregateStatus(k8sOk, pgOk, provisioner);

    return {
      status,
      kubernetes: k8sOk ? "connected" : "disconnected",
      postgres: pgOk ? "connected" : "disconnected",
      provisioner,
    };
  }
}

/**
 * Pure aggregator — keeps the controller deterministic and easy to
 * unit-test without spinning up a NestJS context.
 *
 * Order of precedence:
 *   `provisioner === "stopped"`            → `error`  (only HTTP 503 path)
 *   `!k8sOk || !pgOk`                       → `degraded`
 *   `provisioner === "degraded"`            → `degraded`
 *   else                                    → `ok`
 */
function aggregateStatus(
  k8sOk: boolean,
  pgOk: boolean,
  provisioner: ITenantProvisionerState,
): "ok" | "degraded" | "error" {
  if (provisioner === "stopped") return "error";
  if (!k8sOk || !pgOk) return "degraded";
  if (provisioner === "degraded") return "degraded";
  return "ok";
}
