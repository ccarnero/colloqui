/**
 * Persistence layer for `public_routes` and Redis sync queries — PostgreSQL.
 */
import { Inject, Injectable } from "@nestjs/common";
import { POSTGRES_SQL, type Sql } from "@yoizen/database";
import { authServiceConfig } from "../../config";
import type {
  IPublicRouteRow,
  IPublicRoutesRepository,
} from "./public-routes.repository.interface";

@Injectable()
export class PublicRoutesPostgresRepository implements IPublicRoutesRepository {
  readonly environmentName: string;

  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {
    this.environmentName = authServiceConfig.platformEnvironment;
  }

  async insertRoute(
    id: string,
    method: string,
    pathPattern: string,
    scope: string,
  ): Promise<IPublicRouteRow[]> {
    const rows = await this.sql<IPublicRouteRow[]>`
      INSERT INTO public_routes (id, method, path_pattern, scope, environment)
      VALUES (${id}, ${method}, ${pathPattern}, ${scope}, ${this.environmentName})
      RETURNING id, method, path_pattern, scope, environment, created_at
    `;
    return rows;
  }

  async listForTenant(tenantScope: string): Promise<IPublicRouteRow[]> {
    const rows = await this.sql<IPublicRouteRow[]>`
      SELECT id, method, path_pattern, scope, environment, created_at
      FROM public_routes
      WHERE environment = ${this.environmentName}
        AND (scope = 'platform' OR scope = ${tenantScope})
      ORDER BY created_at DESC
    `;
    return rows;
  }

  async listAll(): Promise<IPublicRouteRow[]> {
    const rows = await this.sql<IPublicRouteRow[]>`
      SELECT id, method, path_pattern, scope, environment, created_at
      FROM public_routes
      WHERE environment = ${this.environmentName}
      ORDER BY created_at DESC
    `;
    return rows;
  }

  async deleteById(id: string): Promise<{ id: string }[]> {
    const rows = await this.sql<Array<{ id: string }>>`
      DELETE FROM public_routes
      WHERE id = ${id} AND environment = ${this.environmentName}
      RETURNING id
    `;
    return rows;
  }

  async loadSyncRows(): Promise<
    Array<{ method: unknown; path_pattern: unknown; scope: unknown }>
  > {
    const rows = await this.sql<
      Array<{ method: unknown; path_pattern: unknown; scope: unknown }>
    >`
      SELECT method, path_pattern, scope
      FROM public_routes
      WHERE environment = ${this.environmentName}
    `;
    return rows;
  }
}
