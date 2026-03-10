import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type * as k8s from '@kubernetes/client-node';
import type { Sql } from 'postgres';
import { K8S_CUSTOM_OBJECTS_API } from '../../providers/kubernetes.provider';
import { POSTGRES_SQL } from '../../providers/postgres.provider';
import {
  REGISTRY_KNATIVE_GROUP,
  REGISTRY_KNATIVE_VERSION,
  REGISTRY_KNATIVE_SERVICES_PLURAL,
  REGISTRY_KNATIVE_REVISIONS_PLURAL,
} from '@yoizen/shared';
import {
  type RegisterServiceDto,
  type UpdateServiceDto,
  type Environment,
  VALID_ENVIRONMENTS,
} from './services.dto';

interface RegisteredService {
  id: string;
  tenantId: string;
  name: string;
  image: string;
  port: number;
  minScale: number;
  maxScale: number;
  concurrencyTarget: number;
  envVars: Record<string, string>;
  status: string;
  knativeName: string | null;
  namespace: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ServiceDetail extends RegisteredService {
  knativeStatus?: Record<string, unknown>;
}

interface RevisionInfo {
  name: string;
  ready: boolean;
  createdAt: string;
  image: string;
}

function generateId(): string {
  return crypto.randomUUID();
}

function knativeServiceName(serviceName: string, tenantId: string): string {
  return `${serviceName}-${tenantId}`;
}

function namespaceName(tenantId: string, env: Environment): string {
  return `${tenantId}-${env}-ns`;
}

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);
  private readonly environment: Environment;

  constructor(
    @Inject(K8S_CUSTOM_OBJECTS_API)
    private readonly customApi: k8s.CustomObjectsApi,
    @Inject(POSTGRES_SQL) private readonly sql: Sql,
  ) {
    const env = process.env.PLATFORM_ENVIRONMENT ?? 'dev';
    if (!VALID_ENVIRONMENTS.includes(env as Environment)) {
      throw new Error(
        `Invalid PLATFORM_ENVIRONMENT: '${env}'. Must be one of: ${VALID_ENVIRONMENTS.join(', ')}`,
      );
    }
    this.environment = env as Environment;
  }

  async register(
    tenantId: string,
    dto: RegisterServiceDto,
  ): Promise<RegisteredService> {
    const ksvcName = knativeServiceName(dto.name, tenantId);
    const ns = namespaceName(tenantId, this.environment);
    const id = generateId();

    const existing = await this.sql`
      SELECT id FROM registered_services
      WHERE tenant_id = ${tenantId} AND name = ${dto.name}
    `;
    if (existing.length > 0) {
      throw new ConflictException(
        `Service '${dto.name}' already registered for tenant '${tenantId}'`,
      );
    }

    const port = dto.port ?? 3000;
    const minScale = dto.minScale ?? 0;
    const maxScale = dto.maxScale ?? 10;
    const concurrencyTarget = dto.concurrencyTarget ?? 100;
    const envVars = dto.envVars ?? {};

    await this.createKnativeService(
      ns,
      ksvcName,
      dto.image,
      port,
      minScale,
      maxScale,
      concurrencyTarget,
      envVars,
    );

    const [row] = await this.sql`
      INSERT INTO registered_services
        (id, tenant_id, name, image, port, min_scale, max_scale,
         concurrency_target, env_vars, status, knative_name, namespace)
      VALUES
        (${id}, ${tenantId}, ${dto.name}, ${dto.image}, ${port},
         ${minScale}, ${maxScale}, ${concurrencyTarget},
         ${JSON.stringify(envVars)}, 'active', ${ksvcName}, ${ns})
      RETURNING *
    `;

    this.logger.log(`Registered service ${ksvcName} in ${ns}`);
    return this.mapRow(row);
  }

  async list(tenantId: string): Promise<RegisteredService[]> {
    const rows = await this.sql`
      SELECT * FROM registered_services
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
    `;
    return rows.map(this.mapRow);
  }

  async get(tenantId: string, id: string): Promise<ServiceDetail> {
    const [row] = await this.sql`
      SELECT * FROM registered_services
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) {
      throw new NotFoundException(`Service '${id}' not found`);
    }

    const svc = this.mapRow(row);
    let knativeStatus: Record<string, unknown> | undefined;

    if (svc.knativeName && svc.namespace) {
      try {
        const resp = await this.customApi.getNamespacedCustomObject({
          group: REGISTRY_KNATIVE_GROUP,
          version: REGISTRY_KNATIVE_VERSION,
          namespace: svc.namespace,
          plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
          name: svc.knativeName,
        });
        const obj = resp as Record<string, unknown>;
        knativeStatus = (obj.status as Record<string, unknown>) ?? {};
      } catch {
        knativeStatus = { error: 'unable to fetch Knative status' };
      }
    }

    return { ...svc, knativeStatus };
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateServiceDto,
  ): Promise<RegisteredService> {
    const [row] = await this.sql`
      SELECT * FROM registered_services
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) {
      throw new NotFoundException(`Service '${id}' not found`);
    }

    const image = dto.image ?? row.image;
    const port = dto.port ?? row.port;
    const minScale = dto.minScale ?? row.min_scale;
    const maxScale = dto.maxScale ?? row.max_scale;
    const concurrencyTarget = dto.concurrencyTarget ?? row.concurrency_target;
    const envVars = dto.envVars ?? row.env_vars;

    if (row.knative_name && row.namespace) {
      await this.updateKnativeService(
        row.namespace,
        row.knative_name,
        image,
        port,
        minScale,
        maxScale,
        concurrencyTarget,
        envVars,
      );
    }

    const [updated] = await this.sql`
      UPDATE registered_services SET
        image = ${image},
        port = ${port},
        min_scale = ${minScale},
        max_scale = ${maxScale},
        concurrency_target = ${concurrencyTarget},
        env_vars = ${JSON.stringify(envVars)},
        updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING *
    `;

    this.logger.log(`Updated service ${row.knative_name}`);
    return this.mapRow(updated);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const [row] = await this.sql`
      SELECT * FROM registered_services
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) {
      throw new NotFoundException(`Service '${id}' not found`);
    }

    if (row.knative_name && row.namespace) {
      try {
        await this.customApi.deleteNamespacedCustomObject({
          group: REGISTRY_KNATIVE_GROUP,
          version: REGISTRY_KNATIVE_VERSION,
          namespace: row.namespace,
          plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
          name: row.knative_name,
        });
      } catch (e: any) {
        if (e?.response?.statusCode !== 404) throw e;
      }
    }

    await this.sql`DELETE FROM registered_services WHERE id = ${id}`;
    this.logger.log(`Removed service ${row.knative_name}`);
  }

  async listRevisions(
    tenantId: string,
    id: string,
  ): Promise<RevisionInfo[]> {
    const [row] = await this.sql`
      SELECT knative_name, namespace FROM registered_services
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) {
      throw new NotFoundException(`Service '${id}' not found`);
    }
    if (!row.knative_name || !row.namespace) {
      return [];
    }

    try {
      const resp = await this.customApi.listNamespacedCustomObject({
        group: REGISTRY_KNATIVE_GROUP,
        version: REGISTRY_KNATIVE_VERSION,
        namespace: row.namespace,
        plural: REGISTRY_KNATIVE_REVISIONS_PLURAL,
        labelSelector: `serving.knative.dev/service=${row.knative_name}`,
      });

      const list = resp as { items?: any[] };
      return (list.items ?? []).map((rev: any) => ({
        name: rev.metadata?.name ?? '',
        ready: rev.status?.conditions?.some(
          (c: any) => c.type === 'Ready' && c.status === 'True',
        ) ?? false,
        createdAt: rev.metadata?.creationTimestamp ?? '',
        image: rev.spec?.containers?.[0]?.image ?? '',
      }));
    } catch {
      return [];
    }
  }

  private async createKnativeService(
    namespace: string,
    name: string,
    image: string,
    port: number,
    minScale: number,
    maxScale: number,
    concurrencyTarget: number,
    envVars: Record<string, string>,
  ): Promise<void> {
    const envList = Object.entries(envVars).map(([k, v]) => ({
      name: k,
      value: v,
    }));

    const body = {
      apiVersion: `${REGISTRY_KNATIVE_GROUP}/${REGISTRY_KNATIVE_VERSION}`,
      kind: 'Service',
      metadata: {
        name,
        namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'registry-service',
          'app.kubernetes.io/part-of': 'yoizen-arch',
        },
      },
      spec: {
        template: {
          metadata: {
            annotations: {
              'autoscaling.knative.dev/class': 'kpa.autoscaling.knative.dev',
              'autoscaling.knative.dev/metric': 'concurrency',
              'autoscaling.knative.dev/target': String(concurrencyTarget),
              'autoscaling.knative.dev/min-scale': String(minScale),
              'autoscaling.knative.dev/max-scale': String(maxScale),
            },
          },
          spec: {
            containerConcurrency: 0,
            containers: [
              {
                name: 'user-container',
                image,
                ports: [{ containerPort: port, protocol: 'TCP' }],
                ...(envList.length > 0 ? { env: envList } : {}),
                securityContext: {
                  runAsNonRoot: true,
                  allowPrivilegeEscalation: false,
                  capabilities: { drop: ['ALL'] },
                  seccompProfile: { type: 'RuntimeDefault' },
                },
                resources: {
                  requests: { cpu: '50m', memory: '64Mi' },
                  limits: { cpu: '500m', memory: '256Mi' },
                },
                readinessProbe: {
                  httpGet: { path: '/health', port },
                  initialDelaySeconds: 5,
                  periodSeconds: 5,
                },
              },
            ],
          },
        },
      },
    };

    try {
      await this.customApi.createNamespacedCustomObject({
        group: REGISTRY_KNATIVE_GROUP,
        version: REGISTRY_KNATIVE_VERSION,
        namespace,
        plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
        body,
      });
    } catch (e: any) {
      this.logger.error(
        `Failed to create Knative Service ${name}: ${e?.response?.body?.message ?? e.message}`,
      );
      throw new InternalServerErrorException(
        `Failed to create Knative Service: ${e?.response?.body?.message ?? e.message}`,
      );
    }
  }

  private async updateKnativeService(
    namespace: string,
    name: string,
    image: string,
    port: number,
    minScale: number,
    maxScale: number,
    concurrencyTarget: number,
    envVars: Record<string, string>,
  ): Promise<void> {
    const envList = Object.entries(envVars).map(([k, v]) => ({
      name: k,
      value: v,
    }));

    const current = await this.customApi.getNamespacedCustomObject({
      group: REGISTRY_KNATIVE_GROUP,
      version: REGISTRY_KNATIVE_VERSION,
      namespace,
      plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
      name,
    }) as any;

    const spec = structuredClone(current.spec);
    spec.template.metadata ??= {};
    spec.template.metadata.annotations = {
      ...spec.template.metadata.annotations,
      'autoscaling.knative.dev/target': String(concurrencyTarget),
      'autoscaling.knative.dev/min-scale': String(minScale),
      'autoscaling.knative.dev/max-scale': String(maxScale),
    };
    spec.template.spec.containers = [
      {
        name: 'user-container',
        image,
        ports: [{ containerPort: port, protocol: 'TCP' }],
        ...(envList.length > 0 ? { env: envList } : {}),
      },
    ];

    try {
      await this.customApi.replaceNamespacedCustomObject({
        group: REGISTRY_KNATIVE_GROUP,
        version: REGISTRY_KNATIVE_VERSION,
        namespace,
        plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
        name,
        body: { ...current, spec },
      });
    } catch (e: any) {
      this.logger.error(
        `Failed to update Knative Service ${name}: ${e?.response?.body?.message ?? e.message}`,
      );
      throw new InternalServerErrorException(
        `Failed to update Knative Service: ${e?.response?.body?.message ?? e.message}`,
      );
    }
  }

  private mapRow(row: any): RegisteredService {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      image: row.image,
      port: row.port,
      minScale: row.min_scale,
      maxScale: row.max_scale,
      concurrencyTarget: row.concurrency_target,
      envVars: row.env_vars,
      status: row.status,
      knativeName: row.knative_name,
      namespace: row.namespace,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
