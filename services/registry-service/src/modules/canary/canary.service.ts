import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type * as k8s from "@kubernetes/client-node";
import { K8S_CUSTOM_OBJECTS_API } from "../../providers/kubernetes.provider";
import {
  CANARY_REPOSITORY,
  type ICanaryRepository,
} from "./canary.repository.interface";
import type { StartCanaryDto, UpdateCanaryDto } from "./canary.dto";
import { generateId } from "@yoizen/shared";
import { k8sApiErrorMessage } from "../../utils/k8s-error";
import {
  type ICanaryStatus,
  mapCanaryDeploymentRow,
  getNamespacedKnativeService,
  replaceNamespacedKnativeService,
} from "../../common/registry-row-mappers";

interface IKnativeTrafficTarget {
  percent?: number;
  tag?: string;
  revisionName?: string;
}

interface IKnativeServiceSpecMutable {
  template?: {
    metadata?: { annotations?: Record<string, string> };
    spec?: {
      containers?: Array<Record<string, unknown>>;
    };
  };
  traffic?: IKnativeTrafficEntry[];
}

interface IKnativeTrafficEntry {
  revisionName: string;
  percent: number;
  tag: string;
}

interface IKnativeServiceBody {
  apiVersion?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
  spec: IKnativeServiceSpecMutable;
}

interface IApplyTrafficSplitParams {
  namespace: string;
  name: string;
  primaryRevision: string;
  primaryPercent: number;
  secondaryRevision: string | null;
  secondaryPercent: number;
}

@Injectable()
export class CanaryService {
  private readonly logger = new PinoLoggerService(CanaryService.name);

  constructor(
    @Inject(K8S_CUSTOM_OBJECTS_API)
    private readonly customApi: k8s.CustomObjectsApi,
    @Inject(CANARY_REPOSITORY)
    private readonly canaryRepository: ICanaryRepository,
  ) {}

  async start(
    tenantId: string,
    serviceId: string,
    dto: StartCanaryDto,
  ): Promise<ICanaryStatus> {
    const svc = await this.getRegisteredService(tenantId, serviceId);

    const existingCanary =
      await this.canaryRepository.findProgressingCanary(serviceId);
    if (existingCanary.length > 0) {
      throw new BadRequestException(
        "Active canary deployment already exists. Promote or rollback first.",
      );
    }

    const stableRevision = await this.getCurrentRevision(
      svc.namespace,
      svc.knative_name,
    );
    if (!stableRevision) {
      throw new BadRequestException(
        "No stable revision found for this service",
      );
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
        "Failed to create new revision for canary",
      );
    }

    await this.applyTrafficSplit({
      namespace: svc.namespace,
      name: svc.knative_name,
      primaryRevision: stableRevision,
      primaryPercent: 100 - dto.percent,
      secondaryRevision: canaryRevision,
      secondaryPercent: dto.percent,
    });

    const id = generateId();
    const [row] = await this.canaryRepository.insertCanaryDeployment({
      id,
      serviceId,
      stableRevision,
      canaryRevision,
      percent: dto.percent,
    });

    this.logger.log(
      `Started canary for ${svc.knative_name}: ${stableRevision} -> ${canaryRevision} at ${dto.percent}%`,
    );
    return mapCanaryDeploymentRow(row);
  }

  async updatePercent(
    tenantId: string,
    serviceId: string,
    dto: UpdateCanaryDto,
  ): Promise<ICanaryStatus> {
    const svc = await this.getRegisteredService(tenantId, serviceId);
    const canary = await this.getActiveCanary(serviceId);

    await this.applyTrafficSplit({
      namespace: svc.namespace,
      name: svc.knative_name,
      primaryRevision: canary.stable_revision,
      primaryPercent: 100 - dto.percent,
      secondaryRevision: canary.canary_revision,
      secondaryPercent: dto.percent,
    });

    const [updated] = await this.canaryRepository.updateCanaryPercent(
      String(canary.id),
      dto,
    );

    this.logger.log(
      `Updated canary for ${svc.knative_name} to ${dto.percent}%`,
    );
    return mapCanaryDeploymentRow(updated);
  }

  async promote(tenantId: string, serviceId: string): Promise<ICanaryStatus> {
    const svc = await this.getRegisteredService(tenantId, serviceId);
    const canary = await this.getActiveCanary(serviceId);

    await this.applyTrafficSplit({
      namespace: svc.namespace,
      name: svc.knative_name,
      primaryRevision: canary.canary_revision,
      primaryPercent: 100,
      secondaryRevision: null,
      secondaryPercent: 0,
    });

    const [updated] = await this.canaryRepository.updateCanaryPromoted(
      String(canary.id),
    );

    this.logger.log(`Promoted canary for ${svc.knative_name}`);
    return mapCanaryDeploymentRow(updated);
  }

  async rollback(tenantId: string, serviceId: string): Promise<ICanaryStatus> {
    const svc = await this.getRegisteredService(tenantId, serviceId);
    const canary = await this.getActiveCanary(serviceId);

    await this.applyTrafficSplit({
      namespace: svc.namespace,
      name: svc.knative_name,
      primaryRevision: canary.stable_revision,
      primaryPercent: 100,
      secondaryRevision: null,
      secondaryPercent: 0,
    });

    const [updated] = await this.canaryRepository.updateCanaryRolledBack(
      String(canary.id),
    );

    this.logger.log(`Rolled back canary for ${svc.knative_name}`);
    return mapCanaryDeploymentRow(updated);
  }

  async getStatus(
    tenantId: string,
    serviceId: string,
  ): Promise<ICanaryStatus | null> {
    await this.getRegisteredService(tenantId, serviceId);

    const [row] = await this.canaryRepository.getLatestCanaryForService(
      serviceId,
    );
    return row ? mapCanaryDeploymentRow(row) : null;
  }

  private async getRegisteredService(
    tenantId: string,
    serviceId: string,
  ): Promise<{ namespace: string; knative_name: string }> {
    const [svc] = await this.canaryRepository.findRegisteredService(
      serviceId,
      tenantId,
    );
    if (!svc) {
      throw new NotFoundException(`Service '${serviceId}' not found`);
    }
    const knative_name =
      svc.knative_name != null ? String(svc.knative_name) : "";
    const namespace = svc.namespace != null ? String(svc.namespace) : "";
    if (!knative_name || !namespace) {
      throw new BadRequestException("Service is not deployed");
    }
    return { namespace, knative_name };
  }

  private async getActiveCanary(serviceId: string): Promise<{
    id: string;
    stable_revision: string;
    canary_revision: string;
  }> {
    const [canary] = await this.canaryRepository.findActiveCanary(serviceId);
    if (!canary) {
      throw new NotFoundException("No active canary deployment found");
    }
    return {
      id: String(canary.id ?? canary._id ?? ""),
      stable_revision: String(canary.stable_revision),
      canary_revision: String(canary.canary_revision),
    };
  }

  /**
   * Single K8s read for revision fields used by {@link getCurrentRevision} and
   * {@link getLatestRevision}.
   */
  private async fetchKnativeRevisionInfo(
    namespace: string,
    name: string,
  ): Promise<{
    stableTrafficOrFirst: string | null;
    latestReady: string | null;
    latestCreated: string | null;
  } | null> {
    try {
      const resp = await getNamespacedKnativeService(
        this.customApi,
        namespace,
        name,
      );
      const obj = resp as Record<string, unknown>;
      const status = obj.status as Record<string, unknown> | undefined;
      const traffic = status?.traffic;
      let stableTrafficOrFirst: string | null = null;
      if (Array.isArray(traffic) && traffic.length > 0) {
        const targets = traffic as IKnativeTrafficTarget[];
        const stable = targets.find(
          (t) => t.percent === 100 || t.tag === "stable",
        );
        const first = targets[0];
        stableTrafficOrFirst =
          stable?.revisionName ??
          (typeof first?.revisionName === "string" ? first.revisionName : null);
      }
      const latestReady = status?.latestReadyRevisionName;
      const latestCreated = status?.latestCreatedRevisionName;
      return {
        stableTrafficOrFirst,
        latestReady: typeof latestReady === "string" ? latestReady : null,
        latestCreated: typeof latestCreated === "string" ? latestCreated : null,
      };
    } catch (e: unknown) {
      this.logger.warn(
        `fetchKnativeRevisionInfo failed for ${namespace}/${name}: ${k8sApiErrorMessage(e)}`,
      );
      return null;
    }
  }

  private async getCurrentRevision(
    namespace: string,
    name: string,
  ): Promise<string | null> {
    const info = await this.fetchKnativeRevisionInfo(namespace, name);
    if (!info) return null;
    return info.stableTrafficOrFirst ?? info.latestReady;
  }

  private async getLatestRevision(
    namespace: string,
    name: string,
  ): Promise<string | null> {
    const info = await this.fetchKnativeRevisionInfo(namespace, name);
    return info?.latestCreated ?? null;
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
    const current = (await getNamespacedKnativeService(
      this.customApi,
      namespace,
      name,
    )) as unknown as IKnativeServiceBody;

    const spec = structuredClone(current.spec);
    if (!spec.template?.spec?.containers?.[0]) {
      throw new InternalServerErrorException(
        "Knative Service has no template or containers in spec",
      );
    }
    spec.template.metadata ??= {};
    spec.template.metadata.annotations = {
      ...spec.template.metadata.annotations,
      "client.knative.dev/updateTimestamp": String(Date.now()),
    };
    const containers = spec.template.spec.containers;
    (containers[0] as { image: string }).image = image;

    try {
      await replaceNamespacedKnativeService(
        this.customApi,
        namespace,
        name,
        { ...current, spec } as Record<string, unknown>,
      );
    } catch (e: unknown) {
      throw new InternalServerErrorException(
        `Failed to update Knative image: ${k8sApiErrorMessage(e)}`,
      );
    }
  }

  private async applyTrafficSplit(
    params: IApplyTrafficSplitParams,
  ): Promise<void> {
    const {
      namespace,
      name,
      primaryRevision,
      primaryPercent,
      secondaryRevision,
      secondaryPercent,
    } = params;
    const traffic: IKnativeTrafficEntry[] = [
      {
        revisionName: primaryRevision,
        percent: primaryPercent,
        tag: "stable",
      },
    ];

    if (secondaryRevision && secondaryPercent > 0) {
      traffic.push({
        revisionName: secondaryRevision,
        percent: secondaryPercent,
        tag: "canary",
      });
    }

    const current = (await getNamespacedKnativeService(
      this.customApi,
      namespace,
      name,
    )) as unknown as IKnativeServiceBody;

    const spec = structuredClone(current.spec);
    spec.traffic = traffic;

    try {
      await replaceNamespacedKnativeService(
        this.customApi,
        namespace,
        name,
        { ...current, spec } as Record<string, unknown>,
      );
    } catch (e: unknown) {
      throw new InternalServerErrorException(
        `Failed to apply traffic split: ${k8sApiErrorMessage(e)}`,
      );
    }
  }
}
