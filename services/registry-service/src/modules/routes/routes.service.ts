import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import type { Sql } from 'postgres';
import { POSTGRES_SQL } from '../../providers/postgres.provider';
import type { CreateRouteDto } from './routes.dto';
import { generateId } from '../../utils/id';

interface ServiceRoute {
  id: string;
  serviceId: string;
  pathPrefix: string;
  methods: string[];
  isPublic: boolean;
  stripPrefix: boolean;
  createdAt: string;
}

interface RouteDiscoveryEntry {
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

function isPostgresUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: string }).code === '23505'
  );
}

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  private readonly routeCache = new Map<string, { data: RouteDiscoveryEntry[]; ts: number }>();
  private static readonly CACHE_TTL_MS = 10_000;

  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async create(
    tenantId: string,
    serviceId: string,
    dto: CreateRouteDto,
  ): Promise<ServiceRoute> {
    const [svc] = await this.sql`
      SELECT id FROM registered_services
      WHERE id = ${serviceId} AND tenant_id = ${tenantId}
    `;
    if (!svc) {
      throw new NotFoundException(`Service '${serviceId}' not found`);
    }

    const methods: string[] =
      dto.methods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    const isPublic = dto.isPublic ?? false;
    const stripPrefix = dto.stripPrefix ?? true;
    const id = generateId();

    try {
      const [row] = await this.sql`
        INSERT INTO service_routes
          (id, service_id, path_prefix, methods, is_public, strip_prefix)
        VALUES
          (${id}, ${serviceId}, ${dto.pathPrefix}, ${methods}, ${isPublic}, ${stripPrefix})
        RETURNING *
      `;
      this.routeCache.clear();
      this.logger.log(`Created route ${dto.pathPrefix} for service ${serviceId}`);
      return this.mapRow(row);
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
  ): Promise<ServiceRoute[]> {
    const [svc] = await this.sql`
      SELECT id FROM registered_services
      WHERE id = ${serviceId} AND tenant_id = ${tenantId}
    `;
    if (!svc) {
      throw new NotFoundException(`Service '${serviceId}' not found`);
    }

    const rows = await this.sql`
      SELECT * FROM service_routes
      WHERE service_id = ${serviceId}
      ORDER BY created_at ASC
    `;
    return rows.map(this.mapRow);
  }

  async remove(
    tenantId: string,
    serviceId: string,
    routeId: string,
  ): Promise<void> {
    const [svc] = await this.sql`
      SELECT id FROM registered_services
      WHERE id = ${serviceId} AND tenant_id = ${tenantId}
    `;
    if (!svc) {
      throw new NotFoundException(`Service '${serviceId}' not found`);
    }

    const result = await this.sql`
      DELETE FROM service_routes
      WHERE id = ${routeId} AND service_id = ${serviceId}
    `;
    if (result.count === 0) {
      throw new NotFoundException(`Route '${routeId}' not found`);
    }
    this.routeCache.clear();
    this.logger.log(`Removed route ${routeId}`);
  }

  async discover(): Promise<RouteDiscoveryEntry[]> {
    const cacheKey = '__all__';
    const cached = this.routeCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < RoutesService.CACHE_TTL_MS) {
      return cached.data;
    }

    const rows = await this.sql`
      SELECT
        sr.id,
        rs.tenant_id,
        rs.name AS service_name,
        rs.knative_name,
        rs.namespace,
        rs.port,
        sr.path_prefix,
        sr.methods,
        sr.is_public,
        sr.strip_prefix
      FROM service_routes sr
      JOIN registered_services rs ON rs.id = sr.service_id
      WHERE rs.status = 'active'
      ORDER BY rs.tenant_id, sr.path_prefix
    `;

    const entries: RouteDiscoveryEntry[] = rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      serviceName: r.service_name,
      knativeName: r.knative_name,
      namespace: r.namespace,
      port: r.port,
      pathPrefix: r.path_prefix,
      methods: r.methods,
      isPublic: r.is_public,
      stripPrefix: r.strip_prefix,
    }));

    this.routeCache.set(cacheKey, { data: entries, ts: Date.now() });
    return entries;
  }

  private mapRow(row: Record<string, unknown>): ServiceRoute {
    const rawMethods = row.methods;
    const methods = Array.isArray(rawMethods)
      ? rawMethods.map((m) => String(m))
      : [];
    return {
      id: String(row.id ?? ''),
      serviceId: String(row.service_id ?? ''),
      pathPrefix: String(row.path_prefix ?? ''),
      methods,
      isPublic: Boolean(row.is_public),
      stripPrefix: Boolean(row.strip_prefix),
      createdAt: String(row.created_at ?? ''),
    };
  }
}
