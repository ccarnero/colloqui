/**
 * Persistence layer for `public_routes` and Redis sync queries.
 */
import { Inject, Injectable } from "@nestjs/common";
import { POSTGRES_SQL, type Sql } from "../../providers/postgres.provider";
import { authServiceConfig } from "../../config";

export interface IPublicRouteRow {
  id: string;
  method: string;
  path_pattern: string;
  scope: string;
  environment: string;
  created_at: Date;
}

@Injectable()
export class PublicRoutesRepository {
  private readonly environment: string;

  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {
    this.environment = authServiceConfig.platformEnvironment;
  }

  get environmentName(): string {
    return this.environment;
  }

  async insertRoute(
    id: string,
    method: string,
    pathPattern: string,
    scope: string,
  ): Promise<IPublicRouteRow[]> {
    return this.sql`
      INSERT INTO public_routes (id, method, path_pattern, scope, environment)
      VALUES (${id}, ${method}, ${pathPattern}, ${scope}, ${this.environment})
      RETURNING id, method, path_pattern, scope, environment, created_at
    ` as Promise<IPublicRouteRow[]>;
  }

  async listForTenant(tenantScope: string): Promise<IPublicRouteRow[]> {
    const rows = await this.sql`
      SELECT id, method, path_pattern, scope, environment, created_at
      FROM public_routes
      WHERE environment = ${this.environment}
        AND (scope = 'platform' OR scope = ${tenantScope})
      ORDER BY created_at DESC
    `;
    return rows as unknown as IPublicRouteRow[];
  }

  async listAll(): Promise<IPublicRouteRow[]> {
    const rows = await this.sql`
      SELECT id, method, path_pattern, scope, environment, created_at
      FROM public_routes
      WHERE environment = ${this.environment}
      ORDER BY created_at DESC
    `;
    return rows as unknown as IPublicRouteRow[];
  }

  async deleteById(id: string): Promise<{ id: string }[]> {
    return this.sql`
      DELETE FROM public_routes
      WHERE id = ${id} AND environment = ${this.environment}
      RETURNING id
    `;
  }

  async loadSyncRows(): Promise<
    Array<{ method: unknown; path_pattern: unknown; scope: unknown }>
  > {
    return this.sql`
      SELECT method, path_pattern, scope
      FROM public_routes
      WHERE environment = ${this.environment}
    `;
  }
}
