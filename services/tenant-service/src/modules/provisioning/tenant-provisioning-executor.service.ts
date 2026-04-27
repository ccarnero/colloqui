import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type * as k8s from "@kubernetes/client-node";
import {
  TenantDatabaseTier,
  invalidPlatformEnvironmentMessage,
  tenantKubernetesNamespaceName,
  type TenantDatabaseTierValue,
} from "@yoizen/shared";
import { K8S_CORE_API } from "../../providers/kubernetes.provider";
import { isKubernetesConflictError } from "../../providers/kubernetes-errors";
import { TenantPostgresProvisioner } from "../../providers/postgres.provider";
import { TenantUsagePostgresProvisioner } from "../../providers/postgres-usage.provider";
import { tenantServiceConfig } from "../../config";
import {
  type Environment,
  type TenantConfiguration,
  VALID_ENVIRONMENTS,
} from "../tenants/tenant.dto";

const LABEL_TENANT = "yoizen.io/tenant";
const LABEL_ENVIRONMENT = "yoizen.io/environment";
const LABEL_MANAGED_BY = "yoizen.io/managed-by";
const LABEL_PART_OF = "app.kubernetes.io/part-of";
const MANAGED_BY_VALUE = "tenant-service";
const PART_OF_VALUE = "yoizen-arch";

interface ITenantProvisioningRunParams {
  readonly name: string;
  readonly tier?: TenantDatabaseTierValue;
  readonly configuration: TenantConfiguration;
}

function unwrapNamespace(res: unknown): k8s.V1Namespace {
  if (res && typeof res === "object" && "body" in res) {
    return (res as { body: k8s.V1Namespace }).body;
  }
  return res as k8s.V1Namespace;
}

@Injectable()
export class TenantProvisioningExecutor {
  private readonly logger = new PinoLoggerService(
    TenantProvisioningExecutor.name,
  );
  private readonly environment: Environment;

  constructor(
    @Inject(K8S_CORE_API) private readonly k8sApi: k8s.CoreV1Api,
    private readonly pgProvisioner: TenantPostgresProvisioner,
    private readonly pgUsageProvisioner: TenantUsagePostgresProvisioner,
  ) {
    const env = tenantServiceConfig.platformEnvironment;
    if (!VALID_ENVIRONMENTS.includes(env as Environment)) {
      throw new InternalServerErrorException(
        invalidPlatformEnvironmentMessage(env),
      );
    }
    this.environment = env as Environment;
  }

  /**
   * Creates or reconciles the tenant namespace, then provisions OLTP + usage
   * PostgreSQL according to `tier`:
   *
   * - **Shared**: only creates a logical database + role on the shared
   *   CloudNativePG cluster (no per-tenant Postgres StatefulSet/PVC). The
   *   namespace itself is still created because it is the per-tenant
   *   deployment scope for `registry-service` (Knative Services) and
   *   `scheduler-service` (Job-mode executions). An empty namespace is
   *   essentially free in K8s (one metadata object + default ServiceAccount).
   * - **Dedicated**: provisions per-tenant Postgres + TimescaleDB StatefulSets
   *   inside the namespace and blocks until both report ready.
   *
   * Idempotent: namespace create conflict (409) continues with `readNamespace`.
   */
  async run(params: ITenantProvisioningRunParams): Promise<{
    nsName: string;
    namespacePhase: string;
  }> {
    const { name } = params;
    const tier = params.tier ?? TenantDatabaseTier.Shared;
    const nsName = tenantKubernetesNamespaceName(name, this.environment);
    const body: k8s.V1Namespace = {
      metadata: {
        name: nsName,
        labels: {
          [LABEL_PART_OF]: PART_OF_VALUE,
          [LABEL_TENANT]: name,
          [LABEL_ENVIRONMENT]: this.environment,
          [LABEL_MANAGED_BY]: MANAGED_BY_VALUE,
        },
      },
    };

    let phase = "Active";
    try {
      const created = await this.k8sApi.createNamespace({ body });
      const ns = unwrapNamespace(created);
      phase = ns.status?.phase ?? "Active";
    } catch (err: unknown) {
      if (isKubernetesConflictError(err)) {
        this.logger.log(
          `Namespace ${nsName} already exists, continuing provisioning`,
        );
        const read = await this.k8sApi.readNamespace({ name: nsName });
        const ns = unwrapNamespace(read);
        phase = ns.status?.phase ?? "Active";
      } else {
        throw err;
      }
    }

    await Promise.all([
      this.pgProvisioner.provision({ namespace: nsName, tenantId: name, tier }),
      this.pgUsageProvisioner.provisionUsage(nsName, tier),
    ]);
    await Promise.all([
      this.pgProvisioner.waitForReady(nsName, tier),
      this.pgUsageProvisioner.waitForReady(nsName, tier),
    ]);

    this.logger.log(
      `Background provisioning complete for tenant '${name}' in ${nsName}`,
    );

    return { nsName, namespacePhase: phase };
  }
}
