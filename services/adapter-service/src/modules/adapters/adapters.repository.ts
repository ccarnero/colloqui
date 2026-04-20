import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "postgres";
import { AdapterStatus, generateId, type AdapterStatusValue } from "@yoizen/shared";
import { isPostgresUniqueViolation } from "@yoizen/database";
import { POSTGRES_SQL } from "../../providers/postgres.provider";
import type {
  CreateAdapterDto,
  UpdateAdapterDto,
  CreateEndpointDto,
} from "./adapters.dto";
import { ADAPTER_UPDATE_FIELD_MAP } from "./adapter-update-fields";

export interface IAdapterRow {
  id: string;
  tenant_id: string;
  name: string;
  context: string;
  base_url: string;
  auth_type: string;
  auth_config: Record<string, unknown>;
  headers: Array<{ key: string; value: string }>;
  timeout_ms: number;
  max_retries: number;
  retry_backoff_ms: number;
  health_check_path: string;
  is_encrypted: boolean;
  tags: string[];
  status: AdapterStatusValue;
  managed_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Params for upserting an internal-adapter mirror materialized from a
 * registry-service `service.upserted` event. The caller sets
 * `managedBy="registry-service"` so the row is flagged as externally
 * managed and read-only via the public API.
 */
export interface IUpsertMirrorParams {
  readonly tenantId: string;
  readonly serviceName: string;
  readonly baseUrl: string;
  readonly healthCheckPath: string;
  readonly status: AdapterStatusValue;
  readonly managedBy: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryBackoffMs?: number;
}

export interface IEndpointRow {
  id: string;
  adapter_id: string;
  label: string;
  method: string;
  path: string;
  created_at: string;
}

function parseJsonb<T>(value: T | string, fallback: T): T {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function mapAdapter(row: IAdapterRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    context: row.context,
    baseUrl: row.base_url,
    authType: row.auth_type,
    authConfig: parseJsonb(row.auth_config, {}),
    headers: parseJsonb(row.headers, []),
    timeoutMs: row.timeout_ms,
    maxRetries: row.max_retries,
    retryBackoffMs: row.retry_backoff_ms,
    healthCheckPath: row.health_check_path,
    status: row.status,
    isEncrypted: row.is_encrypted,
    tags: row.tags ?? [],
    managedBy: row.managed_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapEndpoint(row: IEndpointRow) {
  return {
    id: row.id,
    adapterId: row.adapter_id,
    label: row.label,
    method: row.method,
    path: row.path,
    createdAt: row.created_at,
  };
}

/**
 * Persists `http_adapters` and `adapter_endpoints` rows via postgres.js.
 */
@Injectable()
export class AdaptersRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  /**
   * Inserts one adapter and optional inline endpoints.
   *
   * @param tenantId - Owning tenant.
   * @param dto - Create payload; may include `endpoints` to insert in the same round-trip.
   * @returns Raw rows for mapping in the service layer.
   */
  async insertAdapterWithEndpoints(
    tenantId: string,
    dto: CreateAdapterDto,
  ): Promise<{ row: IAdapterRow; endpoints: IEndpointRow[] }> {
    const id = generateId();
    const authType = dto.authType ?? "none";
    const authConfig = dto.authConfig ?? {};
    const headers = dto.headers ?? [];
    const timeoutMs = dto.timeoutMs ?? 5000;
    const maxRetries = dto.maxRetries ?? 3;
    const retryBackoffMs = dto.retryBackoffMs ?? 1000;
    const healthCheckPath = dto.healthCheckPath ?? "/health";
    const status = AdapterStatus.ENABLED;
    const tags = dto.tags ?? [];

    const [row] = await this.sql<IAdapterRow[]>`
      INSERT INTO http_adapters
        (id, tenant_id, name, context, base_url, auth_type, auth_config,
         headers, timeout_ms, max_retries, retry_backoff_ms,
         health_check_path, status, tags)
      VALUES
        (${id}, ${tenantId}, ${dto.name}, ${dto.context},
         ${dto.baseUrl ?? ""}, ${authType},
         ${this.sql.json(authConfig as never)},
         ${this.sql.json(headers as never)}, ${timeoutMs},
         ${maxRetries}, ${retryBackoffMs}, ${healthCheckPath},
         ${status}, ${tags})
      RETURNING *
    `;

    let endpoints: IEndpointRow[] = [];
    if (dto.endpoints?.length) {
      endpoints = await this.insertEndpoints(id, dto.endpoints);
    }
    return { row, endpoints };
  }

  isUniqueViolation(e: unknown): boolean {
    return isPostgresUniqueViolation(e);
  }

  /**
   * Paged list with optional filters. All filters are composable.
   * Uses `sql.unsafe` free dynamic fragments so the query plan stays
   * stable (indexes on `tenant_id`, `(tenant_id, context)`, GIN on `tags`).
   */
  async listRows(
    tenantId: string,
    context: string | undefined,
    limit: number,
    offset: number,
    tag?: string,
    name?: string,
  ): Promise<IAdapterRow[]> {
    const sql = this.sql;
    const ctxFragment = context
      ? sql`AND context = ${context}`
      : sql``;
    const nameFragment = name ? sql`AND name = ${name}` : sql``;
    const tagFragment = tag
      ? sql`AND ${tag} = ANY(tags) AND tags IS NOT NULL`
      : sql``;

    return sql<IAdapterRow[]>`
      SELECT * FROM http_adapters
      WHERE tenant_id = ${tenantId}
        ${ctxFragment}
        ${nameFragment}
        ${tagFragment}
      ORDER BY created_at ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  /**
   * Finds the internal-adapter mirror for a service name. At most one
   * row exists due to the `(tenant_id, name)` uniqueness constraint.
   */
  async findInternalMirror(
    tenantId: string,
    serviceName: string,
    managedBy: string,
  ): Promise<IAdapterRow | null> {
    const [row] = await this.sql<IAdapterRow[]>`
      SELECT * FROM http_adapters
      WHERE tenant_id = ${tenantId}
        AND name = ${serviceName}
        AND managed_by = ${managedBy}
      LIMIT 1
    `;
    return row ?? null;
  }

  /**
   * Idempotent upsert of an internal-adapter mirror. Only overwrites
   * registry-managed fields (baseUrl, healthCheckPath, status). Does NOT
   * touch headers/auth/timeouts/retries on UPDATE so future operator
   * overrides on those fields aren't clobbered.
   *
   * Guards against clobbering a manually-owned adapter with the same
   * name: if the existing row has a different `managed_by`, throws.
   */
  async upsertMirror(params: IUpsertMirrorParams): Promise<IAdapterRow> {
    const {
      tenantId,
      serviceName,
      baseUrl,
      healthCheckPath,
      status,
      managedBy,
      timeoutMs = 30_000,
      maxRetries = 0,
      retryBackoffMs = 0,
    } = params;

    const [existing] = await this.sql<IAdapterRow[]>`
      SELECT * FROM http_adapters
      WHERE tenant_id = ${tenantId} AND name = ${serviceName}
      LIMIT 1
    `;

    if (existing) {
      if (existing.managed_by && existing.managed_by !== managedBy) {
        throw new Error(
          `Adapter '${serviceName}' for tenant '${tenantId}' is managed by '${existing.managed_by}'`,
        );
      }
      const [updated] = await this.sql<IAdapterRow[]>`
        UPDATE http_adapters SET
          base_url = ${baseUrl},
          health_check_path = ${healthCheckPath},
          status = ${status},
          managed_by = ${managedBy},
          updated_at = NOW()
        WHERE id = ${existing.id}
        RETURNING *
      `;
      return updated!;
    }

    const id = generateId();
    const [row] = await this.sql<IAdapterRow[]>`
      INSERT INTO http_adapters (
        id, tenant_id, name, context, base_url, auth_type,
        timeout_ms, max_retries, retry_backoff_ms,
        health_check_path, status, managed_by
      )
      VALUES (
        ${id}, ${tenantId}, ${serviceName}, 'internal', ${baseUrl}, 'none',
        ${timeoutMs}, ${maxRetries}, ${retryBackoffMs},
        ${healthCheckPath}, ${status}, ${managedBy}
      )
      RETURNING *
    `;
    return row!;
  }

  /**
   * Deletes the internal-adapter mirror for a service by name. Safe to
   * call when no row exists. Returns the count of deleted rows.
   */
  async deleteMirrorByServiceName(
    tenantId: string,
    serviceName: string,
    managedBy: string,
  ): Promise<number> {
    const result = await this.sql`
      DELETE FROM http_adapters
      WHERE tenant_id = ${tenantId}
        AND name = ${serviceName}
        AND managed_by = ${managedBy}
    `;
    return result.count;
  }

  /** All internal mirrors for a tenant (used by backfill/diagnostics). */
  async listMirrorsByTenant(
    tenantId: string,
    managedBy: string,
  ): Promise<IAdapterRow[]> {
    return this.sql<IAdapterRow[]>`
      SELECT * FROM http_adapters
      WHERE tenant_id = ${tenantId}
        AND managed_by = ${managedBy}
      ORDER BY created_at ASC
    `;
  }

  async listEndpointsForAdapters(adapterIds: string[]): Promise<IEndpointRow[]> {
    if (adapterIds.length === 0) return [];
    return this.sql<IEndpointRow[]>`
      SELECT * FROM adapter_endpoints
      WHERE adapter_id = ANY(${adapterIds})
      ORDER BY created_at ASC
    `;
  }

  async getAdapterRow(tenantId: string, id: string): Promise<IAdapterRow | null> {
    const [row] = await this.sql<IAdapterRow[]>`
      SELECT * FROM http_adapters
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    return row ?? null;
  }

  async listEndpointsForAdapter(adapterId: string): Promise<IEndpointRow[]> {
    return this.sql<IEndpointRow[]>`
      SELECT * FROM adapter_endpoints
      WHERE adapter_id = ${adapterId}
      ORDER BY created_at ASC
    `;
  }

  async adapterExists(tenantId: string, id: string): Promise<boolean> {
    const [existing] = await this.sql<{ id: string }[]>`
      SELECT id FROM http_adapters
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    return Boolean(existing);
  }

  async updateAdapter(
    tenantId: string,
    id: string,
    dto: UpdateAdapterDto,
  ): Promise<void> {
    // Build update queries for each field individually
    // This is safer than dynamic SQL generation

    if (dto.name !== undefined) {
      await this.sql`UPDATE http_adapters SET name = ${dto.name}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    }
    if (dto.baseUrl !== undefined) {
      await this.sql`UPDATE http_adapters SET base_url = ${dto.baseUrl}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    }
    if (dto.authType !== undefined) {
      await this.sql`UPDATE http_adapters SET auth_type = ${dto.authType}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    }
    if (dto.authConfig !== undefined) {
      await this.sql`UPDATE http_adapters SET auth_config = ${this.sql.json(dto.authConfig as never)}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    }
    if (dto.headers !== undefined) {
      await this.sql`UPDATE http_adapters SET headers = ${this.sql.json(dto.headers as never)}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    }
    if (dto.timeoutMs !== undefined) {
      await this.sql`UPDATE http_adapters SET timeout_ms = ${dto.timeoutMs}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    }
    if (dto.maxRetries !== undefined) {
      await this.sql`UPDATE http_adapters SET max_retries = ${dto.maxRetries}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    }
    if (dto.retryBackoffMs !== undefined) {
      await this.sql`UPDATE http_adapters SET retry_backoff_ms = ${dto.retryBackoffMs}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    }
    if (dto.healthCheckPath !== undefined) {
      await this.sql`UPDATE http_adapters SET health_check_path = ${dto.healthCheckPath}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    }
    if (dto.status !== undefined) {
      await this.sql`UPDATE http_adapters SET status = ${dto.status}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    }
    if (dto.tags !== undefined) {
      await this.sql`UPDATE http_adapters SET tags = ${dto.tags}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    }
  }

  async deleteAdapter(tenantId: string, id: string): Promise<number> {
    const result = await this.sql`
      DELETE FROM http_adapters
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    return result.count;
  }

  async insertEndpoint(
    adapterId: string,
    dto: CreateEndpointDto,
  ): Promise<IEndpointRow> {
    return this.insertOneEndpointRow(adapterId, dto);
  }

  async deleteEndpoint(adapterId: string, endpointId: string): Promise<number> {
    const result = await this.sql`
      DELETE FROM adapter_endpoints
      WHERE id = ${endpointId} AND adapter_id = ${adapterId}
    `;
    return result.count;
  }

  private async insertEndpoints(
    adapterId: string,
    dtos: CreateEndpointDto[],
  ): Promise<IEndpointRow[]> {
    const rows: IEndpointRow[] = [];
    for (const dto of dtos) {
      rows.push(await this.insertOneEndpointRow(adapterId, dto));
    }
    return rows;
  }

  private async insertOneEndpointRow(
    adapterId: string,
    dto: CreateEndpointDto,
  ): Promise<IEndpointRow> {
    const epId = generateId();
    const [row] = await this.sql<IEndpointRow[]>`
      INSERT INTO adapter_endpoints (id, adapter_id, label, method, path)
      VALUES (${epId}, ${adapterId}, ${dto.label}, ${dto.method}, ${dto.path})
      RETURNING *
    `;
    return row;
  }
}
