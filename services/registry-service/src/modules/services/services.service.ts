import type * as k8s from "@kubernetes/client-node";
import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  generateId,
  invalidPlatformEnvironmentMessage,
  REGISTRY_DEFAULT_SERVICE_PORT,
  REGISTRY_KNATIVE_GROUP,
  REGISTRY_KNATIVE_REVISIONS_PLURAL,
  REGISTRY_KNATIVE_SERVICES_PLURAL,
  REGISTRY_KNATIVE_VERSION,
  tenantKubernetesNamespaceName,
} from "@yoizen/shared";
import {
  getNamespacedKnativeService,
  type IRegisteredService,
  mapRegisteredServiceRow,
} from "../../common/registry-row-mappers";
import { registryServiceConfig } from "../../config";
import { K8S_CUSTOM_OBJECTS_API } from "../../providers/kubernetes.provider";
import { isK8sNotFound, k8sApiErrorMessage } from "../../utils/k8s-error";
import { replaceKnativeServiceWithConflictRetry } from "../../utils/k8s-retry";
import {
  buildKnativeServiceBody,
  envRecordToKnativeEnvList,
  type IBuildKnativeServiceBodyParams,
  type IKnativeServiceResourcePatch,
} from "./knative-builder";
import { ServiceEventsPublisher } from "./service-events.publisher";
import {
  type Environment,
  type RegisterServiceDto,
  type ServiceEnvVars,
  type UpdateServiceDto,
  VALID_ENVIRONMENTS,
} from "./services.dto";
import type { IServicesRepository } from "./services.repository.interface";
import { SERVICES_REPOSITORY } from "./services.repository.interface";

interface IServiceDetail extends IRegisteredService {
  knativeStatus?: Record<string, unknown>;
}

interface IRevisionInfo {
  name: string;
  ready: boolean;
  createdAt: string;
  image: string;
}

function knativeServiceName(serviceName: string, tenantId: string): string {
  return `${serviceName}-${tenantId}`;
}

function namespaceName(tenantId: string, env: Environment): string {
  return tenantKubernetesNamespaceName(tenantId, env);
}

/** Knative Revision list item (subset used for listRevisions). */
interface IKnativeRevisionListItem {
  metadata?: { name?: string; creationTimestamp?: string };
  status?: {
    conditions?: Array<{ type?: string; status?: string }>;
  };
  spec?: {
    containers?: Array<{ image?: string }>;
  };
}

interface IKnativeRevisionListResponse {
  items?: IKnativeRevisionListItem[];
}

@Injectable()
export class ServicesService {
  private readonly logger = new PinoLoggerService(ServicesService.name);
  private readonly environment: Environment;

  constructor(
    @Inject(K8S_CUSTOM_OBJECTS_API)
    private readonly customApi: k8s.CustomObjectsApi,
    @Inject(SERVICES_REPOSITORY)
    private readonly servicesRepository: IServicesRepository,
    @Inject(ServiceEventsPublisher)
    private readonly eventsPublisher: ServiceEventsPublisher,
  ) {
    const env = registryServiceConfig.platformEnvironment;
    if (!VALID_ENVIRONMENTS.includes(env as Environment)) {
      throw new InternalServerErrorException(
        invalidPlatformEnvironmentMessage(env),
      );
    }
    this.environment = env as Environment;
  }

  async register(
    tenantId: string,
    dto: RegisterServiceDto
  ): Promise<IRegisteredService> {
    const ksvcName = knativeServiceName(dto.name, tenantId);
    const ns = namespaceName(tenantId, this.environment);
    const id = generateId();

    const existing = await this.servicesRepository.findIdByTenantAndName(
      tenantId,
      dto.name
    );
    if (existing.length > 0) {
      throw new ConflictException(
        `Service '${dto.name}' already registered for tenant '${tenantId}'`
      );
    }

    const port = dto.port ?? REGISTRY_DEFAULT_SERVICE_PORT;
    const minScale = dto.minScale ?? 0;
    const maxScale = dto.maxScale ?? 10;
    const concurrencyTarget = dto.concurrencyTarget ?? 100;
    const envVars = dto.envVars ?? {};

    await this.createKnativeService({
      namespace: ns,
      name: ksvcName,
      image: dto.image,
      port,
      minScale,
      maxScale,
      concurrencyTarget,
      envVars,
    });

    const [row] = await this.servicesRepository.insertRegisteredService({
      id,
      tenantId,
      dto,
      port,
      minScale,
      maxScale,
      concurrencyTarget,
      envVars,
      ksvcName,
      ns,
    });

    const mapped = mapRegisteredServiceRow(row);
    await this.eventsPublisher.publishUpserted({
      serviceId: mapped.id,
      tenantId: mapped.tenantId,
      name: mapped.name,
      knativeName: mapped.knativeName,
      namespace: mapped.namespace,
      port: mapped.port,
      status: mapped.status,
    });

    this.logger.log(`Registered service ${ksvcName} in ${ns}`);
    return mapped;
  }

  async list(tenantId: string): Promise<IRegisteredService[]> {
    const rows = await this.servicesRepository.listByTenant(tenantId);
    return rows.map(mapRegisteredServiceRow);
  }

  async get(tenantId: string, id: string): Promise<IServiceDetail> {
    const [row] = await this.servicesRepository.findByIdAndTenant(id, tenantId);
    if (!row) {
      throw new NotFoundException(`Service '${id}' not found`);
    }

    const svc = mapRegisteredServiceRow(row);
    let knativeStatus: Record<string, unknown> | undefined;

    if (svc.knativeName && svc.namespace) {
      try {
        const resp = await getNamespacedKnativeService(
          this.customApi,
          svc.namespace,
          svc.knativeName
        );
        const obj = resp as Record<string, unknown>;
        knativeStatus = (obj.status as Record<string, unknown>) ?? {};
      } catch (e: unknown) {
        this.logger.warn(
          `Knative status fetch failed for ${svc.knativeName}: ${k8sApiErrorMessage(e)}`
        );
        knativeStatus = { error: "unable to fetch Knative status" };
      }
    }

    return { ...svc, knativeStatus };
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateServiceDto
  ): Promise<IRegisteredService> {
    const [row] = await this.servicesRepository.findByIdAndTenant(id, tenantId);
    if (!row) {
      throw new NotFoundException(`Service '${id}' not found`);
    }

    const image = String(dto.image ?? row.image ?? "");
    const port = Number(dto.port ?? row.port ?? REGISTRY_DEFAULT_SERVICE_PORT);
    const minScale = Number(dto.minScale ?? row.min_scale ?? 0);
    const maxScale = Number(dto.maxScale ?? row.max_scale ?? 10);
    const concurrencyTarget = Number(
      dto.concurrencyTarget ?? row.concurrency_target ?? 100
    );
    const envVarsRaw = dto.envVars ?? row.env_vars;
    const envVars: ServiceEnvVars =
      envVarsRaw && typeof envVarsRaw === "object" && !Array.isArray(envVarsRaw)
        ? (envVarsRaw as ServiceEnvVars)
        : {};

    if (row.knative_name && row.namespace) {
      await this.updateKnativeService({
        namespace: String(row.namespace),
        name: String(row.knative_name),
        image,
        port,
        minScale,
        maxScale,
        concurrencyTarget,
        envVars,
      });
    }

    const [updated] = await this.servicesRepository.updateRegisteredService({
      id,
      tenantId,
      image,
      port,
      minScale,
      maxScale,
      concurrencyTarget,
      envVars,
    });

    const mapped = mapRegisteredServiceRow(updated);
    await this.eventsPublisher.publishUpserted({
      serviceId: mapped.id,
      tenantId: mapped.tenantId,
      name: mapped.name,
      knativeName: mapped.knativeName,
      namespace: mapped.namespace,
      port: mapped.port,
      status: mapped.status,
    });

    this.logger.log(`Updated service ${row.knative_name}`);
    return mapped;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const [row] = await this.servicesRepository.findByIdAndTenant(id, tenantId);
    if (!row) {
      throw new NotFoundException(`Service '${id}' not found`);
    }

    if (row.knative_name && row.namespace) {
      try {
        await this.customApi.deleteNamespacedCustomObject({
          group: REGISTRY_KNATIVE_GROUP,
          version: REGISTRY_KNATIVE_VERSION,
          namespace: String(row.namespace),
          plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
          name: String(row.knative_name),
        });
      } catch (e: unknown) {
        if (!isK8sNotFound(e)) {
          throw e;
        }
      }
    }

    await this.servicesRepository.deleteById(id);

    await this.eventsPublisher.publishDeleted({
      serviceId: id,
      tenantId,
      name: String(row.name ?? ""),
    });

    this.logger.log(`Removed service ${row.knative_name}`);
  }

  async listRevisions(tenantId: string, id: string): Promise<IRevisionInfo[]> {
    const [row] = await this.servicesRepository.selectKnativeMetaForRevision(
      id,
      tenantId
    );
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
        namespace: String(row.namespace),
        plural: REGISTRY_KNATIVE_REVISIONS_PLURAL,
        labelSelector: `serving.knative.dev/service=${String(row.knative_name)}`,
      });

      const list = resp as unknown as IKnativeRevisionListResponse;
      return (list.items ?? []).map((rev) => ({
        name: rev.metadata?.name ?? "",
        ready:
          rev.status?.conditions?.some(
            (c) => c.type === "Ready" && c.status === "True"
          ) ?? false,
        createdAt: rev.metadata?.creationTimestamp ?? "",
        image: rev.spec?.containers?.[0]?.image ?? "",
      }));
    } catch (e: unknown) {
      this.logger.warn(
        `List Knative revisions failed for ${row.knative_name}: ${k8sApiErrorMessage(e)}`
      );
      return [];
    }
  }

  private async createKnativeService(
    params: IBuildKnativeServiceBodyParams
  ): Promise<void> {
    const { namespace, name } = params;
    const body = buildKnativeServiceBody(params);

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
        `Failed to create Knative Service: ${msg}`
      );
    }
  }

  private async updateKnativeService(
    params: IBuildKnativeServiceBodyParams
  ): Promise<void> {
    const {
      namespace,
      name,
      image,
      port,
      minScale,
      maxScale,
      concurrencyTarget,
      envVars,
    } = params;
    const envList = envRecordToKnativeEnvList(envVars);

    try {
      await replaceKnativeServiceWithConflictRetry(
        this.customApi,
        namespace,
        name,
        (current) => {
          const typedCurrent =
            current as unknown as IKnativeServiceResourcePatch;
          const spec = structuredClone(typedCurrent.spec);
          spec.template.metadata ??= {};
          spec.template.metadata.annotations = {
            ...spec.template.metadata.annotations,
            "autoscaling.knative.dev/target": String(concurrencyTarget),
            "autoscaling.knative.dev/min-scale": String(minScale),
            "autoscaling.knative.dev/max-scale": String(maxScale),
          };
          spec.template.spec.containers = [
            {
              name: "user-container",
              image,
              ports: [{ containerPort: port, protocol: "TCP" }],
              ...(envList.length > 0 ? { env: envList } : {}),
            },
          ];
          return { ...current, spec } as Record<string, unknown>;
        }
      );
    } catch (e: unknown) {
      const msg = k8sApiErrorMessage(e);
      this.logger.error(`Failed to update Knative Service ${name}: ${msg}`);
      throw new InternalServerErrorException(
        `Failed to update Knative Service: ${msg}`
      );
    }
  }
}
