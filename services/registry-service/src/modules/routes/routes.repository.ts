import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "postgres";
import { POSTGRES_SQL } from "../../providers/postgres.provider";
import type { CreateRouteDto } from "./routes.dto";

export type IRouteRow = Record<string, unknown>;
export type IRouteDiscoverySqlRow = Record<string, unknown>;

/** Options for inserting a service route row. */
export interface IInsertRouteOptions {
  id: string;
  serviceId: string;
  dto: CreateRouteDto;
  methods: string[];
  isPublic: boolean;
  stripPrefix: boolean;
}

@Injectable()
export class RoutesRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async findServiceByTenant(
    serviceId: string,
    tenantId: string,
  ): Promise<IRouteRow[]> {
    return this.sql`
      SELECT id FROM registered_services
      WHERE id = ${serviceId} AND tenant_id = ${tenantId}
    `;
  }

  async insertRoute(options: IInsertRouteOptions): Promise<IRouteRow[]> {
    const { id, serviceId, dto, methods, isPublic, stripPrefix } = options;
    return this.sql`
      INSERT INTO service_routes
        (id, service_id, path_prefix, methods, is_public, strip_prefix)
      VALUES
        (${id}, ${serviceId}, ${dto.pathPrefix}, ${methods}, ${isPublic}, ${stripPrefix})
      RETURNING *
    `;
  }

  async listRoutesForService(serviceId: string): Promise<IRouteRow[]> {
    return this.sql`
      SELECT * FROM service_routes
      WHERE service_id = ${serviceId}
      ORDER BY created_at ASC
    `;
  }

  async deleteRoute(routeId: string, serviceId: string): Promise<{ count: number }> {
    return this.sql`
      DELETE FROM service_routes
      WHERE id = ${routeId} AND service_id = ${serviceId}
    `;
  }

  async discoverActiveRoutes(): Promise<IRouteDiscoverySqlRow[]> {
    return this.sql`
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
  }
}
