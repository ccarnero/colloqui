import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
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
import { generateId } from '../../utils/id';

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

function knativeServiceName(serviceName: string, tenantId: string): string {
  return `${serviceName}-${tenantId}`;
}

function namespaceName(tenantId: string, env: Environment): string {
  return `${tenantId}-${env}-ns`;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function k8sApiErrorMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'response' in e) {
    const msg = (e as { response?: { body?: { message?: string } } }).response
      ?.body?.message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return errorMessage(e);
}

function isK8sNotFound(e: unknown): boolean {
  if (typeof e === 'object' && e !== null && 'response' in e) {
    return (
      (e as { response?: { statusCode?: number } }).response?.statusCode ===
      404
    );
  }
  return false;
}

/** Knative Revision list item (subset used for listRevisions). */
interface KnativeRevisionListItem {
  metadata?: { name?: string; creationTimestamp?: string };
  status?: {
    conditions?: Array<{ type?: string; status?: string }>;
  };
  spec?: {
    containers?: Array<{ image?: string }>;
  };
}

interface KnativeRevisionListResponse {
  items?: KnativeRevisionListItem[];
}

/** Minimal Knative Service resource for get/replace patch flows. */
interface KnativeServiceSpecPatch {
  template: {
    metadata?: { annotations?: Record<string, string> };
    spec: {
      containers: Array<{
        name: string;
        image: string;
        ports: Array<{ containerPort: number; protocol: string }>;
        env?: Array<{ name: string; value: string }>;
      }>;
    };
  };
}

interface KnativeServiceResourcePatch {
  apiVersion?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
  spec: KnativeServiceSpecPatch;
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
      throw new InternalServerErrorException(
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
         ${this.sql.json(envVars)}, 'active', ${ksvcName}, ${ns})
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
        env_vars = ${this.sql.json(envVars)},
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
      } catch (e: unknown) {
        if (!isK8sNotFound(e)) throw e;
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

      const list = resp as unknown as KnativeRevisionListResponse;
      return (list.items ?? []).map((rev) => ({
        name: rev.metadata?.name ?? '',
        ready:
          rev.status?.conditions?.some(
            (c) => c.type === 'Ready' && c.status === 'True',
          ) ?? false,
        createdAt: rev.metadata?.creationTimestamp ?? '',
        image: rev.spec?.containers?.[0]?.image ?? '',
      }));
    } catch {
      return [];
    }
  }

  private buildKnativeServiceBody(
    namespace: string,
    name: string,
    image: string,
    port: number,
    minScale: number,
    maxScale: number,
    concurrencyTarget: number,
    envVars: Record<string, string>,
  ): Record<string, unknown> {
    const envList = Object.entries(envVars).map(([k, v]) => ({
      name: k,
      value: v,
    }));

    return {
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
                  runAsUser: 1001,
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
    const body = this.buildKnativeServiceBody(
      namespace,
      name,
      image,
      port,
      minScale,
      maxScale,
      concurrencyTarget,
      envVars,
    );

    try {
      await this.customApi.createNamespacedCustomObject({
        group: REGISTRY_KNATIVE_GROUP,
        version: REGISTRY_KNATIVE_VERSION,
        namespace,
        plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
        body,
      });
    } catch (e: unknown) {
      const msg = k8sApiErrorMessage(e);
      this.logger.error(`Failed to create Knative Service ${name}: ${msg}`);
      throw new InternalServerErrorException(
        `Failed to create Knative Service: ${msg}`,
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

    const current = (await this.customApi.getNamespacedCustomObject({
      group: REGISTRY_KNATIVE_GROUP,
      version: REGISTRY_KNATIVE_VERSION,
      namespace,
      plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
      name,
    })) as unknown as KnativeServiceResourcePatch;

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
    } catch (e: unknown) {
      const msg = k8sApiErrorMessage(e);
      this.logger.error(`Failed to update Knative Service ${name}: ${msg}`);
      throw new InternalServerErrorException(
        `Failed to update Knative Service: ${msg}`,
      );
    }
  }

  private mapRow(row: Record<string, unknown>): RegisteredService {
    const envVars = row.env_vars;
    return {
      id: String(row.id ?? ''),
      tenantId: String(row.tenant_id ?? ''),
      name: String(row.name ?? ''),
      image: String(row.image ?? ''),
      port: Number(row.port ?? 0),
      minScale: Number(row.min_scale ?? 0),
      maxScale: Number(row.max_scale ?? 0),
      concurrencyTarget: Number(row.concurrency_target ?? 0),
      envVars:
        envVars !== null &&
        typeof envVars === 'object' &&
        !Array.isArray(envVars)
          ? (envVars as Record<string, string>)
          : {},
      status: String(row.status ?? ''),
      knativeName:
        row.knative_name === null || row.knative_name === undefined
          ? null
          : String(row.knative_name),
      namespace:
        row.namespace === null || row.namespace === undefined
          ? null
          : String(row.namespace),
      createdAt: String(row.created_at ?? ''),
      updatedAt: String(row.updated_at ?? ''),
    };
  }
}
