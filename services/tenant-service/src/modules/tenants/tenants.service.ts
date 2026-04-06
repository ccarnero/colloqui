import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type * as k8s from "@kubernetes/client-node";
import { randomUUID } from "node:crypto";
import { tenantServiceConfig } from "../../config";
import { K8S_CORE_API } from "../../providers/kubernetes.provider";
import { TenantPostgresProvisioner } from "../../providers/postgres.provider";
import { TenantsRepository } from "./tenants.repository";
import {
  type Environment,
  type TenantConfiguration,
  VALID_ENVIRONMENTS,
} from "./tenant.dto";
import {
  invalidPlatformEnvironmentMessage,
  tenantKubernetesNamespaceName,
} from "@yoizen/shared";

const LABEL_TENANT = "yoizen.io/tenant";
const LABEL_ENVIRONMENT = "yoizen.io/environment";
const LABEL_MANAGED_BY = "yoizen.io/managed-by";
const LABEL_PART_OF = "app.kubernetes.io/part-of";
const MANAGED_BY_VALUE = "tenant-service";
const PART_OF_VALUE = "yoizen-arch";

interface INamespaceStatus {
  name: string;
  environment: Environment;
  phase: string;
}

export interface ITenantDetail {
  name: string;
  configuration: TenantConfiguration;
  namespaces: INamespaceStatus[];
  postgresHost: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITenantSummary {
  name: string;
  environment: string;
  configuration: TenantConfiguration;
}

function postgresHost(tenant: string, env: Environment): string {
  return `postgres.${tenantKubernetesNamespaceName(tenant, env)}.svc.cluster.local`;
}

@Injectable()
export class TenantsService {
  private readonly logger = new PinoLoggerService(TenantsService.name);
  private readonly environment: Environment;

  constructor(
    @Inject(K8S_CORE_API) private readonly k8sApi: k8s.CoreV1Api,
    private readonly pgProvisioner: TenantPostgresProvisioner,
    private readonly repository: TenantsRepository,
  ) {
    const env = tenantServiceConfig.platformEnvironment;
    if (!VALID_ENVIRONMENTS.includes(env as Environment)) {
      throw new InternalServerErrorException(
        invalidPlatformEnvironmentMessage(env),
      );
    }
    this.environment = env as Environment;
    this.logger.log(`Tenant service scoped to environment: ${this.environment}`);
  }

  /**
   * Creates DB row, Kubernetes namespace, and provisions PostgreSQL for the tenant.
   *
   * @param name - DNS-safe tenant name.
   * @param configuration - Arbitrary JSON configuration blob.
   */
  async createTenant(
    name: string,
    configuration: TenantConfiguration = {},
  ): Promise<ITenantDetail> {
    const existing = await this.repository.findByName(name);
    if (existing) {
      throw new ConflictException(`Tenant '${name}' already exists`);
    }

    const row = await this.repository.create(randomUUID(), name, configuration);

    const nsName = tenantKubernetesNamespaceName(name, this.environment);
    const body = {
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

    const created = await this.k8sApi.createNamespace({ body });

    await this.pgProvisioner.provision(nsName);
    await this.pgProvisioner.waitForReady(nsName);

    this.logger.log(`Created tenant '${name}' with namespace ${nsName}`);

    const ns: INamespaceStatus = {
      name: nsName,
      environment: this.environment,
      phase: created.status?.phase ?? "Active",
    };

    return {
      name,
      configuration: row.configuration,
      namespaces: [ns],
      postgresHost: postgresHost(name, this.environment),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Lists tenant summaries for the current platform environment.
   */
  async listTenants(): Promise<ITenantSummary[]> {
    const rows = await this.repository.findAll();
    return rows.map((row) => ({
      name: row.name,
      environment: this.environment,
      configuration: row.configuration,
    }));
  }

  /**
   * Returns tenant detail including namespace phases and Postgres host.
   *
   * @param name - Tenant name.
   */
  async getTenant(name: string): Promise<ITenantDetail> {
    const row = await this.repository.findByName(name);
    if (!row) {
      throw new NotFoundException(`Tenant '${name}' not found`);
    }

    const items = await this.findNamespacesByTenant(name);

    return {
      name,
      configuration: row.configuration,
      namespaces: this.mapNamespacesToStatuses(items),
      postgresHost: postgresHost(name, this.environment),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Updates stored configuration JSON for the tenant.
   *
   * @param name - Tenant name.
   * @param configuration - Full replacement configuration object.
   */
  async updateTenant(
    name: string,
    configuration: TenantConfiguration,
  ): Promise<ITenantDetail> {
    const row = await this.repository.updateConfiguration(name, configuration);
    if (!row) {
      throw new NotFoundException(`Tenant '${name}' not found`);
    }

    const items = await this.findNamespacesByTenant(name);

    this.logger.log(`Updated configuration for tenant '${name}'`);

    return {
      name,
      configuration: row.configuration,
      namespaces: this.mapNamespacesToStatuses(items),
      postgresHost: postgresHost(name, this.environment),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Deletes all labeled namespaces (cascades workloads) then removes the DB row.
   *
   * @param name - Tenant name.
   */
  async deleteTenant(name: string): Promise<void> {
    const row = await this.repository.findByName(name);
    if (!row) {
      throw new NotFoundException(`Tenant '${name}' not found`);
    }

    const items = await this.findNamespacesByTenant(name);
    await Promise.all(
      items.map(async (ns) => {
        const nsName = ns.metadata!.name!;
        await this.k8sApi.deleteNamespace({ name: nsName });
        this.logger.log(`Deleted namespace ${nsName} (cascades PG resources)`);
      }),
    );

    const deleted = await this.repository.deleteByName(name);
    if (!deleted) {
      this.logger.warn(
        `Tenant '${name}' was not found in database after namespace cleanup`,
      );
    }
    this.logger.log(`Deleted tenant '${name}' from database`);
  }

  private mapNamespacesToStatuses(
    items: k8s.V1Namespace[],
  ): INamespaceStatus[] {
    return items.map((ns) => ({
      name: ns.metadata!.name!,
      environment: ns.metadata!.labels![LABEL_ENVIRONMENT] as Environment,
      phase: ns.status?.phase ?? "Unknown",
    }));
  }

  private async findNamespacesByTenant(
    tenant: string,
  ): Promise<k8s.V1Namespace[]> {
    const response = await this.k8sApi.listNamespace({
      labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE},${LABEL_TENANT}=${tenant},${LABEL_ENVIRONMENT}=${this.environment}`,
    });
    return response.items;
  }
}
