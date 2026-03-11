import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type * as k8s from '@kubernetes/client-node';
import { randomUUID } from 'node:crypto';
import { K8S_CORE_API } from '../../providers/kubernetes.provider';
import { TenantPostgresProvisioner } from '../../providers/postgres.provider';
import { TenantsRepository } from './tenants.repository';
import {
  type Environment,
  type TenantConfiguration,
  VALID_ENVIRONMENTS,
} from './tenant.dto';

const LABEL_TENANT = 'yoizen.io/tenant';
const LABEL_ENVIRONMENT = 'yoizen.io/environment';
const LABEL_MANAGED_BY = 'yoizen.io/managed-by';
const LABEL_PART_OF = 'app.kubernetes.io/part-of';
const MANAGED_BY_VALUE = 'tenant-service';
const PART_OF_VALUE = 'yoizen-arch';

interface NamespaceStatus {
  name: string;
  environment: Environment;
  phase: string;
}

export interface TenantDetail {
  name: string;
  configuration: TenantConfiguration;
  namespaces: NamespaceStatus[];
  postgresHost: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantSummary {
  name: string;
  environment: string;
  configuration: TenantConfiguration;
}

function namespaceName(tenant: string, env: Environment): string {
  return `${tenant}-${env}-ns`;
}

function postgresHost(tenant: string, env: Environment): string {
  return `postgres.${namespaceName(tenant, env)}.svc.cluster.local`;
}

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);
  private readonly environment: Environment;

  constructor(
    @Inject(K8S_CORE_API) private readonly k8sApi: k8s.CoreV1Api,
    private readonly pgProvisioner: TenantPostgresProvisioner,
    private readonly repository: TenantsRepository,
  ) {
    const env = process.env.PLATFORM_ENVIRONMENT ?? 'dev';
    if (!VALID_ENVIRONMENTS.includes(env as Environment)) {
      throw new Error(
        `Invalid PLATFORM_ENVIRONMENT: '${env}'. Must be one of: ${VALID_ENVIRONMENTS.join(', ')}`,
      );
    }
    this.environment = env as Environment;
    this.logger.log(`Tenant service scoped to environment: ${this.environment}`);
  }

  async createTenant(
    name: string,
    configuration: TenantConfiguration = {},
  ): Promise<TenantDetail> {
    const existing = await this.repository.findByName(name);
    if (existing) {
      throw new ConflictException(`Tenant '${name}' already exists`);
    }

    const row = await this.repository.create(
      randomUUID(),
      name,
      configuration,
    );

    const nsName = namespaceName(name, this.environment);
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

    const ns: NamespaceStatus = {
      name: nsName,
      environment: this.environment,
      phase: created.status?.phase ?? 'Active',
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

  async listTenants(): Promise<TenantSummary[]> {
    const rows = await this.repository.findAll();
    return rows.map((row) => ({
      name: row.name,
      environment: this.environment,
      configuration: row.configuration,
    }));
  }

  async getTenant(name: string): Promise<TenantDetail> {
    const row = await this.repository.findByName(name);
    if (!row) {
      throw new NotFoundException(
        `Tenant '${name}' not found`,
      );
    }

    const items = await this.findNamespacesByTenant(name);
    const namespaces: NamespaceStatus[] = items.map((ns) => ({
      name: ns.metadata!.name!,
      environment: ns.metadata!.labels![LABEL_ENVIRONMENT] as Environment,
      phase: ns.status?.phase ?? 'Unknown',
    }));

    return {
      name,
      configuration: row.configuration,
      namespaces,
      postgresHost: postgresHost(name, this.environment),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async deleteTenant(name: string): Promise<void> {
    const row = await this.repository.findByName(name);
    if (!row) {
      throw new NotFoundException(
        `Tenant '${name}' not found`,
      );
    }

    const items = await this.findNamespacesByTenant(name);
    await Promise.all(
      items.map(async (ns) => {
        const nsName = ns.metadata!.name!;
        await this.k8sApi.deleteNamespace({ name: nsName });
        this.logger.log(`Deleted namespace ${nsName} (cascades PG resources)`);
      }),
    );

    await this.repository.deleteByName(name);
    this.logger.log(`Deleted tenant '${name}' from database`);
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
