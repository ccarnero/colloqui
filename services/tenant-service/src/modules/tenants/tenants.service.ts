import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type * as k8s from '@kubernetes/client-node';
import { K8S_CORE_API } from '../../providers/kubernetes.provider';
import { TenantPostgresProvisioner } from '../../providers/postgres.provider';
import { type Environment, VALID_ENVIRONMENTS } from './tenant.dto';

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
  namespaces: NamespaceStatus[];
  postgresHost: string;
}

export interface TenantSummary {
  name: string;
  environment: string;
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

  async createTenant(name: string): Promise<TenantDetail> {
    const existing = await this.findNamespacesByTenant(name);
    if (existing.length > 0) {
      throw new ConflictException(
        `Tenant '${name}' already exists in ${this.environment}`,
      );
    }

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

    this.logger.log(`Created namespace ${nsName} with dedicated PostgreSQL`);

    const ns: NamespaceStatus = {
      name: nsName,
      environment: this.environment,
      phase: created.status?.phase ?? 'Active',
    };

    return { name, namespaces: [ns], postgresHost: postgresHost(name, this.environment) };
  }

  async listTenants(): Promise<TenantSummary[]> {
    const items = await this.findManagedNamespaces();
    const result: TenantSummary[] = [];

    for (const ns of items) {
      const tenant = ns.metadata?.labels?.[LABEL_TENANT];
      if (!tenant) continue;
      result.push({ name: tenant, environment: this.environment });
    }

    return result;
  }

  async getTenant(name: string): Promise<TenantDetail> {
    const items = await this.findNamespacesByTenant(name);
    if (items.length === 0) {
      throw new NotFoundException(
        `Tenant '${name}' not found in ${this.environment}`,
      );
    }

    const namespaces: NamespaceStatus[] = items.map((ns) => ({
      name: ns.metadata!.name!,
      environment: ns.metadata!.labels![LABEL_ENVIRONMENT] as Environment,
      phase: ns.status?.phase ?? 'Unknown',
    }));

    return {
      name,
      namespaces,
      postgresHost: postgresHost(name, this.environment),
    };
  }

  async deleteTenant(name: string): Promise<void> {
    const items = await this.findNamespacesByTenant(name);
    if (items.length === 0) {
      throw new NotFoundException(
        `Tenant '${name}' not found in ${this.environment}`,
      );
    }

    await Promise.all(
      items.map(async (ns) => {
        const nsName = ns.metadata!.name!;
        await this.k8sApi.deleteNamespace({ name: nsName });
        this.logger.log(`Deleted namespace ${nsName} (cascades PG resources)`);
      }),
    );
  }

  private async findManagedNamespaces(): Promise<k8s.V1Namespace[]> {
    const response = await this.k8sApi.listNamespace({
      labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE},${LABEL_ENVIRONMENT}=${this.environment}`,
    });
    return response.items;
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
