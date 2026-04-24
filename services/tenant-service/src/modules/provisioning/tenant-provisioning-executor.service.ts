import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type * as k8s from "@kubernetes/client-node";
import { invalidPlatformEnvironmentMessage, tenantKubernetesNamespaceName } from "@yoizen/shared";
import { K8S_CORE_API } from "../../providers/kubernetes.provider";
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

function isConflictError(error: unknown): boolean {
  const apiError = error as { response?: { statusCode?: number } };
  return apiError.response?.statusCode === 409;
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
   * Creates or reconciles the tenant namespace, provisions OLTP + usage
   * PostgreSQL, and blocks until both report ready. Idempotent: namespace
   * create conflict (409) continues with read.
   */
  async run(params: { name: string; configuration: TenantConfiguration }): Promise<{
    nsName: string;
    namespacePhase: string;
  }> {
    const { name } = params;
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
      if (isConflictError(err)) {
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
      this.pgProvisioner.provision(nsName),
      this.pgUsageProvisioner.provisionUsage(nsName),
    ]);
    await Promise.all([
      this.pgProvisioner.waitForReady(nsName),
      this.pgUsageProvisioner.waitForReady(nsName),
    ]);

    this.logger.log(
      `Background provisioning complete for tenant '${name}' in ${nsName}`,
    );

    return { nsName, namespacePhase: phase };
  }
}
