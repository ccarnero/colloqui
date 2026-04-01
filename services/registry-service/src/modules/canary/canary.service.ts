import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
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
} from '@yoizen/shared';
import type { StartCanaryDto, UpdateCanaryDto } from './canary.dto';
import { generateId } from '../../utils/id';

interface CanaryStatus {
  id: string;
  serviceId: string;
  stableRevision: string;
  canaryRevision: string;
  canaryPercent: number;
  status: string;
  createdAt: string;
  updatedAt: string;
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

interface KnativeTrafficTarget {
  percent?: number;
  tag?: string;
  revisionName?: string;
}

interface KnativeServiceSpecMutable {
  template?: {
    metadata?: { annotations?: Record<string, string> };
    spec?: {
      containers?: Array<Record<string, unknown>>;
    };
  };
  traffic?: KnativeTrafficEntry[];
}

interface KnativeTrafficEntry {
  revisionName: string;
  percent: number;
  tag: string;
}

interface KnativeServiceBody {
  apiVersion?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
  spec: KnativeServiceSpecMutable;
}

@Injectable()
export class CanaryService {
  private readonly logger = new Logger(CanaryService.name);

  constructor(
    @Inject(K8S_CUSTOM_OBJECTS_API)
    private readonly customApi: k8s.CustomObjectsApi,
    @Inject(POSTGRES_SQL) private readonly sql: Sql,
  ) {}

  async start(
    tenantId: string,
    serviceId: string,
    dto: StartCanaryDto,
  ): Promise<CanaryStatus> {
    const svc = await this.getRegisteredService(tenantId, serviceId);

    const existingCanary = await this.sql`
      SELECT id FROM canary_deployments
      WHERE service_id = ${serviceId} AND status = 'progressing'
    `;
    if (existingCanary.length > 0) {
      throw new BadRequestException(
        'Active canary deployment already exists. Promote or rollback first.',
      );
    }

    const stableRevision = await this.getCurrentRevision(
      svc.namespace,
      svc.knative_name,
    );
    if (!stableRevision) {
      throw new BadRequestException('No stable revision found for this service');
    }

    await this.updateKnativeImage(svc.namespace, svc.knative_name, dto.image);

    const canaryRevision = await this.waitForNewRevision(
      svc.namespace,
      svc.knative_name,
      stableRevision,
      60_000,
    );
    if (!canaryRevision) {
      throw new InternalServerErrorException(
        'Failed to create new revision for canary',
      );
    }

    await this.applyTrafficSplit(
      svc.namespace,
      svc.knative_name,
      stableRevision,
      100 - dto.percent,
      canaryRevision,
      dto.percent,
    );

    const id = generateId();
    const [row] = await this.sql`
      INSERT INTO canary_deployments
        (id, service_id, stable_revision, canary_revision, canary_percent, status)
      VALUES
        (${id}, ${serviceId}, ${stableRevision}, ${canaryRevision}, ${dto.percent}, 'progressing')
      RETURNING *
    `;

    this.logger.log(
      `Started canary for ${svc.knative_name}: ${stableRevision} -> ${canaryRevision} at ${dto.percent}%`,
    );
    return this.mapRow(row);
  }

  async updatePercent(
    tenantId: string,
    serviceId: string,
    dto: UpdateCanaryDto,
  ): Promise<CanaryStatus> {
    const svc = await this.getRegisteredService(tenantId, serviceId);
    const canary = await this.getActiveCanary(serviceId);

    await this.applyTrafficSplit(
      svc.namespace,
      svc.knative_name,
      canary.stable_revision,
      100 - dto.percent,
      canary.canary_revision,
      dto.percent,
    );

    const [updated] = await this.sql`
      UPDATE canary_deployments SET
        canary_percent = ${dto.percent},
        updated_at = NOW()
      WHERE id = ${canary.id}
      RETURNING *
    `;

    this.logger.log(
      `Updated canary for ${svc.knative_name} to ${dto.percent}%`,
    );
    return this.mapRow(updated);
  }

  async promote(
    tenantId: string,
    serviceId: string,
  ): Promise<CanaryStatus> {
    const svc = await this.getRegisteredService(tenantId, serviceId);
    const canary = await this.getActiveCanary(serviceId);

    await this.applyTrafficSplit(
      svc.namespace,
      svc.knative_name,
      canary.canary_revision,
      100,
      null,
      0,
    );

    const [updated] = await this.sql`
      UPDATE canary_deployments SET
        canary_percent = 100,
        status = 'promoted',
        updated_at = NOW()
      WHERE id = ${canary.id}
      RETURNING *
    `;

    this.logger.log(`Promoted canary for ${svc.knative_name}`);
    return this.mapRow(updated);
  }

  async rollback(
    tenantId: string,
    serviceId: string,
  ): Promise<CanaryStatus> {
    const svc = await this.getRegisteredService(tenantId, serviceId);
    const canary = await this.getActiveCanary(serviceId);

    await this.applyTrafficSplit(
      svc.namespace,
      svc.knative_name,
      canary.stable_revision,
      100,
      null,
      0,
    );

    const [updated] = await this.sql`
      UPDATE canary_deployments SET
        canary_percent = 0,
        status = 'rolled_back',
        updated_at = NOW()
      WHERE id = ${canary.id}
      RETURNING *
    `;

    this.logger.log(`Rolled back canary for ${svc.knative_name}`);
    return this.mapRow(updated);
  }

  async getStatus(
    tenantId: string,
    serviceId: string,
  ): Promise<CanaryStatus | null> {
    await this.getRegisteredService(tenantId, serviceId);

    const [row] = await this.sql`
      SELECT * FROM canary_deployments
      WHERE service_id = ${serviceId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return row ? this.mapRow(row) : null;
  }

  private async getRegisteredService(tenantId: string, serviceId: string) {
    const [svc] = await this.sql`
      SELECT * FROM registered_services
      WHERE id = ${serviceId} AND tenant_id = ${tenantId}
    `;
    if (!svc) {
      throw new NotFoundException(`Service '${serviceId}' not found`);
    }
    if (!svc.knative_name || !svc.namespace) {
      throw new BadRequestException('Service is not deployed');
    }
    return svc;
  }

  private async getActiveCanary(serviceId: string) {
    const [canary] = await this.sql`
      SELECT * FROM canary_deployments
      WHERE service_id = ${serviceId} AND status = 'progressing'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!canary) {
      throw new NotFoundException('No active canary deployment found');
    }
    return canary;
  }

  private async getCurrentRevision(
    namespace: string,
    name: string,
  ): Promise<string | null> {
    try {
      const resp = await this.customApi.getNamespacedCustomObject({
        group: REGISTRY_KNATIVE_GROUP,
        version: REGISTRY_KNATIVE_VERSION,
        namespace,
        plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
        name,
      });
      const obj = resp as Record<string, unknown>;
      const status = obj.status as Record<string, unknown> | undefined;
      const traffic = status?.traffic;
      if (Array.isArray(traffic) && traffic.length > 0) {
        const targets = traffic as KnativeTrafficTarget[];
        const stable = targets.find(
          (t) => t.percent === 100 || t.tag === 'stable',
        );
        const first = targets[0];
        return (
          stable?.revisionName ??
          (typeof first?.revisionName === 'string' ? first.revisionName : null)
        );
      }
      const latest = status?.latestReadyRevisionName;
      return typeof latest === 'string' ? latest : null;
    } catch {
      return null;
    }
  }

  private async getLatestRevision(
    namespace: string,
    name: string,
  ): Promise<string | null> {
    try {
      const resp = await this.customApi.getNamespacedCustomObject({
        group: REGISTRY_KNATIVE_GROUP,
        version: REGISTRY_KNATIVE_VERSION,
        namespace,
        plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
        name,
      });
      const obj = resp as Record<string, unknown>;
      const status = obj.status as Record<string, unknown> | undefined;
      const revision = status?.latestCreatedRevisionName;
      return typeof revision === 'string' ? revision : null;
    } catch {
      return null;
    }
  }

  private async waitForNewRevision(
    namespace: string,
    name: string,
    previousRevision: string,
    timeoutMs: number,
  ): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    const pollInterval = 2_000;

    while (Date.now() < deadline) {
      const rev = await this.getLatestRevision(namespace, name);
      if (rev && rev !== previousRevision) return rev;
      await new Promise((r) => setTimeout(r, pollInterval));
    }
    return null;
  }

  private async updateKnativeImage(
    namespace: string,
    name: string,
    image: string,
  ): Promise<void> {
    const current = (await this.customApi.getNamespacedCustomObject({
      group: REGISTRY_KNATIVE_GROUP,
      version: REGISTRY_KNATIVE_VERSION,
      namespace,
      plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
      name,
    })) as unknown as KnativeServiceBody;

    const spec = structuredClone(current.spec);
    if (!spec.template?.spec?.containers?.[0]) {
      throw new InternalServerErrorException(
        'Knative Service has no template or containers in spec',
      );
    }
    spec.template.metadata ??= {};
    spec.template.metadata.annotations = {
      ...spec.template.metadata.annotations,
      'client.knative.dev/updateTimestamp': String(Date.now()),
    };
    const containers = spec.template.spec.containers;
    (containers[0] as { image: string }).image = image;

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
      throw new InternalServerErrorException(
        `Failed to update Knative image: ${k8sApiErrorMessage(e)}`,
      );
    }
  }

  private async applyTrafficSplit(
    namespace: string,
    name: string,
    primaryRevision: string,
    primaryPercent: number,
    secondaryRevision: string | null,
    secondaryPercent: number,
  ): Promise<void> {
    const traffic: KnativeTrafficEntry[] = [
      {
        revisionName: primaryRevision,
        percent: primaryPercent,
        tag: 'stable',
      },
    ];

    if (secondaryRevision && secondaryPercent > 0) {
      traffic.push({
        revisionName: secondaryRevision,
        percent: secondaryPercent,
        tag: 'canary',
      });
    }

    const current = (await this.customApi.getNamespacedCustomObject({
      group: REGISTRY_KNATIVE_GROUP,
      version: REGISTRY_KNATIVE_VERSION,
      namespace,
      plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
      name,
    })) as unknown as KnativeServiceBody;

    const spec = structuredClone(current.spec);
    spec.traffic = traffic;

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
      throw new InternalServerErrorException(
        `Failed to apply traffic split: ${k8sApiErrorMessage(e)}`,
      );
    }
  }

  private mapRow(row: Record<string, unknown>): CanaryStatus {
    return {
      id: String(row.id ?? ''),
      serviceId: String(row.service_id ?? ''),
      stableRevision: String(row.stable_revision ?? ''),
      canaryRevision: String(row.canary_revision ?? ''),
      canaryPercent: Number(row.canary_percent ?? 0),
      status: String(row.status ?? ''),
      createdAt: String(row.created_at ?? ''),
      updatedAt: String(row.updated_at ?? ''),
    };
  }
}
