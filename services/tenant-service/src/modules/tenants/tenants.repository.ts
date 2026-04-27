import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "postgres";
import {
  isTenantDatabaseTier,
  isProvisioningStatus,
  ProvisioningStatus,
  TenantDatabaseTier,
  type ProvisioningStatusValue,
  type TenantDatabaseTierValue,
} from "@yoizen/shared";
import { PLATFORM_POSTGRES_SQL } from "../../providers/platform-postgres.provider";
import type { ITenantRow, TenantConfiguration } from "./tenant.dto";

function mapRow(row: ITenantRow): ITenantRow {
  const raw = row.provisioning_status;
  const rawTier = row.tier;
  const ps: ProvisioningStatusValue =
    raw === undefined || raw === null
      ? ProvisioningStatus.Ready
      : isProvisioningStatus(raw)
        ? raw
        : (() => {
            throw new Error(
              `Invalid provisioning_status in DB: ${String(raw)}`,
            );
          })();
  const tier: TenantDatabaseTierValue =
    rawTier === undefined || rawTier === null
      ? TenantDatabaseTier.Shared
      : isTenantDatabaseTier(rawTier)
        ? rawTier
        : (() => {
            throw new Error(`Invalid tenant tier in DB: ${String(rawTier)}`);
          })();
  return {
    ...row,
    tier,
    provisioning_status: ps,
    provisioning_error: row.provisioning_error ?? null,
    provisioning_started_at: row.provisioning_started_at ?? null,
    provisioning_completed_at: row.provisioning_completed_at ?? null,
  };
}

@Injectable()
export class TenantsRepository {
  constructor(
    @Inject(PLATFORM_POSTGRES_SQL) private readonly sql: Sql,
  ) {}

  async create(
    id: string,
    name: string,
    tier: TenantDatabaseTierValue = TenantDatabaseTier.Shared,
    configuration: TenantConfiguration = {},
  ): Promise<ITenantRow> {
    const [row] = await this.sql<ITenantRow[]>`
      INSERT INTO tenants (id, name, tier, configuration, provisioning_status)
      VALUES (${id}, ${name}, ${tier}, ${this.sql.json(configuration)}, 'pending')
      RETURNING id, name, tier, configuration, created_at, updated_at,
                provisioning_status, provisioning_error, provisioning_started_at, provisioning_completed_at
    `;
    return mapRow(row);
  }

  async findById(id: string): Promise<ITenantRow | undefined> {
    const [row] = await this.sql<ITenantRow[]>`
      SELECT id, name, configuration, created_at, updated_at,
             tier,
             provisioning_status, provisioning_error, provisioning_started_at, provisioning_completed_at
      FROM tenants
      WHERE id = ${id}
    `;
    return row ? mapRow(row) : undefined;
  }

  async findByName(name: string): Promise<ITenantRow | undefined> {
    const [row] = await this.sql<ITenantRow[]>`
      SELECT id, name, configuration, created_at, updated_at,
             tier,
             provisioning_status, provisioning_error, provisioning_started_at, provisioning_completed_at
      FROM tenants
      WHERE name = ${name}
    `;
    return row ? mapRow(row) : undefined;
  }

  async findAll(): Promise<ITenantRow[]> {
    const rows = await this.sql<ITenantRow[]>`
      SELECT id, name, configuration, created_at, updated_at,
             tier,
             provisioning_status, provisioning_error, provisioning_started_at, provisioning_completed_at
      FROM tenants
      ORDER BY created_at ASC
    `;
    const out: ITenantRow[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      out[i] = mapRow(rows[i]!);
    }
    return out;
  }

  async markProvisioningStarted(id: string): Promise<void> {
    await this.sql`
      UPDATE tenants
      SET provisioning_status = 'provisioning',
          provisioning_error = NULL,
          provisioning_started_at = COALESCE(provisioning_started_at, NOW()),
          updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  async markProvisioningReady(id: string): Promise<void> {
    await this.sql`
      UPDATE tenants
      SET provisioning_status = 'ready',
          provisioning_error = NULL,
          provisioning_completed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  async markProvisioningFailed(id: string, err: string): Promise<void> {
    await this.sql`
      UPDATE tenants
      SET provisioning_status = 'failed',
          provisioning_error = ${err},
          provisioning_completed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  async setProvisioningStatus(
    id: string,
    status: ProvisioningStatusValue,
    error: string | null,
  ): Promise<void> {
    await this.sql`
      UPDATE tenants
      SET provisioning_status = ${status},
          provisioning_error = ${error},
          updated_at = NOW()
      WHERE id = ${id}
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
      RETURNING id, name, configuration, created_at, updated_at,
                tier,
                provisioning_status, provisioning_error, provisioning_started_at, provisioning_completed_at
    `;
    return row ? mapRow(row) : undefined;
  }

  async deleteByName(name: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM tenants WHERE name = ${name}
    `;
    return result.count > 0;
  }
}
