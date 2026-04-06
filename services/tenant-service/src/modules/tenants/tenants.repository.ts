import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "postgres";
import { PLATFORM_POSTGRES_SQL } from "../../providers/platform-postgres.provider";
import type { ITenantRow, TenantConfiguration } from "./tenant.dto";

@Injectable()
export class TenantsRepository {
  constructor(
    @Inject(PLATFORM_POSTGRES_SQL) private readonly sql: Sql,
  ) {}

  async create(
    id: string,
    name: string,
    configuration: TenantConfiguration = {},
  ): Promise<ITenantRow> {
    const [row] = await this.sql<ITenantRow[]>`
      INSERT INTO tenants (id, name, configuration)
      VALUES (${id}, ${name}, ${this.sql.json(configuration)})
      RETURNING id, name, configuration, created_at, updated_at
    `;
    return row;
  }

  async findByName(name: string): Promise<ITenantRow | undefined> {
    const [row] = await this.sql<ITenantRow[]>`
      SELECT id, name, configuration, created_at, updated_at
      FROM tenants
      WHERE name = ${name}
    `;
    return row;
  }

  async findAll(): Promise<ITenantRow[]> {
    return this.sql<ITenantRow[]>`
      SELECT id, name, configuration, created_at, updated_at
      FROM tenants
      ORDER BY created_at ASC
    `;
  }

  async updateConfiguration(
    name: string,
    configuration: TenantConfiguration,
  ): Promise<ITenantRow | undefined> {
    const [row] = await this.sql<ITenantRow[]>`
      UPDATE tenants
      SET configuration = ${this.sql.json(configuration)},
          updated_at = NOW()
      WHERE name = ${name}
      RETURNING id, name, configuration, created_at, updated_at
    `;
    return row;
  }

  async deleteByName(name: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM tenants WHERE name = ${name}
    `;
    return result.count > 0;
  }
}
