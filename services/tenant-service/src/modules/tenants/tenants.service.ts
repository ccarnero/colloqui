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
import {
  invalidPlatformEnvironmentMessage,
  ProvisioningStatus,
  tenantKubernetesNamespaceName,
  type ProvisioningStatusValue,
} from "@yoizen/shared";
import { tenantServiceConfig } from "../../config";
import { K8S_CORE_API } from "../../providers/kubernetes.provider";
import { TenantProvisionPublisher } from "../../providers/tenant-provision-publisher.service";
import { TenantsRepository } from "./tenants.repository";
import {
  type Environment,
  type ITenantRow,
  type TenantConfiguration,
  VALID_ENVIRONMENTS,
} from "./tenant.dto";

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
  id: string;
  name: string;
  configuration: TenantConfiguration;
  namespaces: INamespaceStatus[];
  postgresHost: string;
  provisioningStatus: ProvisioningStatusValue;
  provisioningError: string | null;
  provisioningStartedAt: Date | null;
  provisioningCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITenantSummary {
  id: string;
  name: string;
  environment: string;
  configuration: TenantConfiguration;
  provisioningStatus: ProvisioningStatusValue;
}

/** 202 Accepted body for POST /tenants (public path: /api/tenants/:id for status). */
export interface ICreateTenantAccepted {
  id: string;
  name: string;
  provisioningStatus: ProvisioningStatusValue;
  statusUrl: string;
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
    private readonly repository: TenantsRepository,
    private readonly provisionPublisher: TenantProvisionPublisher,
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
   * Inserts platform row (pending), enqueues JetStream provision job, returns 202 payload.
   */
  async createTenant(
    name: string,
    configuration: TenantConfiguration = {},
  ): Promise<ICreateTenantAccepted> {
    const existing = await this.repository.findByName(name);
    if (existing) {
      throw new ConflictException(`Tenant '${name}' already exists`);
    }

    const id = randomUUID();
    const row = await this.repository.create(id, name, configuration);
    await this.provisionPublisher.publishProvisionRequested({
      tenantId: row.id,
      name: row.name,
      configuration: row.configuration,
    });

    return {
      id: row.id,
      name: row.name,
      provisioningStatus: ProvisioningStatus.Pending,
      statusUrl: `/api/tenants/${row.id}`,
    };
  }

  async listTenants(): Promise<ITenantSummary[]> {
    const rows = await this.repository.findAll();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      environment: this.environment,
      configuration: row.configuration,
      provisioningStatus: row.provisioning_status,
    }));
  }

  async getTenantById(id: string): Promise<ITenantDetail> {
    const row = await this.repository.findById(id);
    if (!row) {
      throw new NotFoundException(`Tenant id '${id}' not found`);
    }
    return this.buildDetail(row);
  }

  /**
   * Returns tenant detail including namespace phases and Postgres host.
   */
  async getTenant(name: string): Promise<ITenantDetail> {
    const row = await this.repository.findByName(name);
    if (!row) {
      throw new NotFoundException(`Tenant '${name}' not found`);
    }
    return this.buildDetail(row);
  }

  /**
   * Updates stored configuration JSON for the tenant.
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
    return this.mapRowToDetail(row, items);
  }

  /**
   * Deletes all labeled namespaces (cascades workloads) then removes the DB row.
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

  private async buildDetail(row: ITenantRow): Promise<ITenantDetail> {
    const items = await this.findNamespacesByTenant(row.name);
    return this.mapRowToDetail(row, items);
  }

  private mapRowToDetail(row: ITenantRow, items: k8s.V1Namespace[]): ITenantDetail {
    return {
      id: row.id,
      name: row.name,
      configuration: row.configuration,
      namespaces: this.mapNamespacesToStatuses(items),
      postgresHost: postgresHost(row.name, this.environment),
      provisioningStatus: row.provisioning_status,
      provisioningError: row.provisioning_error,
      provisioningStartedAt: row.provisioning_started_at,
      provisioningCompletedAt: row.provisioning_completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
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
