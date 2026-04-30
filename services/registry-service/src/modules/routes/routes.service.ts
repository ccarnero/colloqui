import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { RoutesRepository } from "./routes.repository";
import type { CreateRouteDto } from "./routes.dto";
import { generateId } from "@yoizen/shared";
import { isPostgresUniqueViolation } from "@yoizen/database";
import {
  type IServiceRoute,
  mapServiceRouteRow,
} from "../../common/registry-row-mappers";

interface IRouteDiscoveryEntry {
  id: string;
  tenantId: string;
  serviceName: string;
  knativeName: string;
  namespace: string;
  port: number;
  pathPrefix: string;
  methods: string[];
  isPublic: boolean;
  stripPrefix: boolean;
}

@Injectable()
export class RoutesService {
  private readonly logger = new PinoLoggerService(RoutesService.name);

  private readonly routeCache = new Map<
    string,
    { data: IRouteDiscoveryEntry[]; ts: number }
  >();
  private static readonly CACHE_TTL_MS = 10_000;

  constructor(private readonly routesRepository: RoutesRepository) {}

  async create(
    tenantId: string,
    serviceId: string,
    dto: CreateRouteDto,
  ): Promise<IServiceRoute> {
    const [svc] = await this.routesRepository.findServiceByTenant(
      serviceId,
      tenantId,
    );
    if (!svc) {
      throw new NotFoundException(`Service '${serviceId}' not found`);
    }

    const methods: string[] = dto.methods ?? [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
    ];
    const isPublic = dto.isPublic ?? false;
    const stripPrefix = dto.stripPrefix ?? true;
    const id = generateId();

    try {
      const [row] = await this.routesRepository.insertRoute({
        id,
        serviceId,
        dto,
        methods,
        isPublic,
        stripPrefix,
      });
      this.routeCache.clear();
      this.logger.log(
        `Created route ${dto.pathPrefix} for service ${serviceId}`,
      );
      return mapServiceRouteRow(row);
    } catch (e: unknown) {
      if (isPostgresUniqueViolation(e)) {
        throw new ConflictException(
          `Route '${dto.pathPrefix}' already exists for this service`,
        );
      }
      throw e;
    }
  }

  async listForService(
    tenantId: string,
    serviceId: string,
  ): Promise<IServiceRoute[]> {
    const [svc] = await this.routesRepository.findServiceByTenant(
      serviceId,
      tenantId,
    );
    if (!svc) {
      throw new NotFoundException(`Service '${serviceId}' not found`);
    }

    const rows = await this.routesRepository.listRoutesForService(serviceId);
    return rows.map(mapServiceRouteRow);
  }

  async remove(
    tenantId: string,
    serviceId: string,
    routeId: string,
  ): Promise<void> {
    const [svc] = await this.routesRepository.findServiceByTenant(
      serviceId,
      tenantId,
    );
    if (!svc) {
      throw new NotFoundException(`Service '${serviceId}' not found`);
    }

    const result = await this.routesRepository.deleteRoute(
      routeId,
      serviceId,
    );
    if (result.count === 0) {
      throw new NotFoundException(`Route '${routeId}' not found`);
    }
    this.routeCache.clear();
    this.logger.log(`Removed route ${routeId}`);
  }

  async discover(): Promise<IRouteDiscoveryEntry[]> {
    const cacheKey = "__all__";
    const cached = this.routeCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < RoutesService.CACHE_TTL_MS) {
      return cached.data;
    }

    const rows = await this.routesRepository.discoverActiveRoutes();

    const entries: IRouteDiscoveryEntry[] = rows.map((r) => ({
      id: String(r.id ?? ""),
      tenantId: String(r.tenant_id ?? ""),
      serviceName: String(r.service_name ?? ""),
      knativeName: String(r.knative_name ?? ""),
      namespace: String(r.namespace ?? ""),
      port: Number(r.port ?? 0),
      pathPrefix: String(r.path_prefix ?? ""),
      methods: r.methods as string[],
      isPublic: Boolean(r.is_public),
      stripPrefix: Boolean(r.strip_prefix),
    }));

    this.routeCache.set(cacheKey, { data: entries, ts: Date.now() });
    return entries;
  }
}
