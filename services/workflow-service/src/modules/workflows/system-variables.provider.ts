import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { SYSTEM_VARIABLES_PG } from "../../providers/providers.module";

/** Cache entry with value and timestamp for TTL-based eviction. */
interface CacheEntry {
  value: Record<string, unknown>;
  ts: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Loads system variables for a tenant from the `system_variables`
 * Postgres table. Results are cached per tenant with a 5-minute TTL.
 *
 * The table is created and managed by `agent-admin-service`; this
 * provider is a read-only consumer. Values are returned as a flat
 * `{ name: value }` map suitable for `variables.system`.
 */
@Injectable()
export class SystemVariablesProvider {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(SYSTEM_VARIABLES_PG)
    private readonly pg: TenantConnectionManager,
  ) {}

  async loadForTenant(tenantId: string): Promise<Record<string, unknown>> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.ts < TTL_MS) {
      return cached.value;
    }

    const sql = await this.pg.ensureSchema(tenantId);
    const rows = await sql<
      Array<{ name: string; value: unknown }>
    >`
      SELECT name, value
      FROM system_variables
      WHERE tenant_id = ${tenantId} AND is_active = true
    `;

    const result: Record<string, unknown> = {};
    for (let i = 0; i < rows.length; i++) {
      result[rows[i]!.name] = rows[i]!.value;
    }

    this.cache.set(tenantId, { value: result, ts: Date.now() });
    return result;
  }
}
