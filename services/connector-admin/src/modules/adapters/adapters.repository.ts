import { Injectable } from "@nestjs/common";
import type { Sql } from "postgres";
import {
  AdapterStatus,
  generateId,
  type AdapterCacheStrategy,
  type AdapterStatusValue,
} from "@yoizen/shared";
import { isPostgresUniqueViolation } from "@yoizen/database";
import { AdapterTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  CreateAdapterDto,
  UpdateAdapterDto,
  CreateEndpointDto,
  UpdateEndpointDto,
} from "./adapters.dto";

export interface IAdapterRow {
  id: string;
  name: string;
  context: string;
  base_url: string;
  auth_type: string;
  auth_config: Record<string, unknown>;
  headers: Array<{ key: string; value: string }>;
  default_cache_strategy: AdapterCacheStrategy | null;
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
  cache_strategy: AdapterCacheStrategy | null;
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

/**
 * Maps a raw row into the HTTP response shape. `tenantId` is supplied by
 * the caller (controller/service) from `x-yoizen-tenant`, NOT from a
 * DB column — each tenant's adapters live in the tenant's own Postgres,
 * so the DB itself is the tenant boundary.
 */
export function mapAdapter(row: IAdapterRow, tenantId: string) {
  return {
    id: row.id,
    tenantId,
    name: row.name,
    context: row.context,
    baseUrl: row.base_url,
    authType: row.auth_type,
    authConfig: parseJsonb(row.auth_config, {}),
    headers: parseJsonb(row.headers, []),
    defaultCache: parseJsonb(row.default_cache_strategy, null),
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
    cache: parseJsonb(row.cache_strategy, null),
    createdAt: row.created_at,
  };
}

/**
 * Persists `http_adapters` and `adapter_endpoints` rows via postgres.js.
 *
 * Each tenant has a dedicated Postgres instance (provisioned by
 * `tenant-service` in its own Kubernetes namespace), so no `tenant_id`
 * column is stored — the DB itself is the tenant boundary. The
 * `tenantId` method parameter is used purely to resolve the correct
 * pool from `AdapterTenantConnectionManager` via `ensureSchema(tenantId)`
 * (O(1) amortised — DDL runs once per tenant).
 */
@Injectable()
export class AdaptersRepository {
  constructor(
    private readonly connections: AdapterTenantConnectionManager,
  ) {}

  private sqlFor(tenantId: string): Promise<Sql> {
    return this.connections.ensureSchema(tenantId);
  }

  /**
   * Inserts one adapter and optional inline endpoints.
   *
   * @param tenantId - Owning tenant (resolves the per-tenant pool).
   * @param dto - Create payload; may include `endpoints` to insert in the same round-trip.
   * @returns Raw rows for mapping in the service layer.
   */
  async insertAdapterWithEndpoints(
    tenantId: string,
    dto: CreateAdapterDto,
  ): Promise<{ row: IAdapterRow; endpoints: IEndpointRow[] }> {
    const sql = await this.sqlFor(tenantId);
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
    const defaultCache = dto.defaultCache ?? null;

    const [row] = await sql<IAdapterRow[]>`
      INSERT INTO http_adapters
        (id, name, context, base_url, auth_type, auth_config,
         headers, default_cache_strategy, timeout_ms, max_retries, retry_backoff_ms,
         health_check_path, status, tags)
      VALUES
        (${id}, ${dto.name}, ${dto.context},
         ${dto.baseUrl ?? ""}, ${authType},
         ${sql.json(authConfig as never)},
         ${sql.json(headers as never)},
         ${defaultCache === null ? null : sql.json(defaultCache as never)},
         ${timeoutMs},
         ${maxRetries}, ${retryBackoffMs}, ${healthCheckPath},
         ${status}, ${tags})
      RETURNING *
    `;

    let endpoints: IEndpointRow[] = [];
    if (dto.endpoints?.length) {
      endpoints = await this.insertEndpoints(sql, id, dto.endpoints);
    }
    return { row: row!, endpoints };
  }

  isUniqueViolation(e: unknown): boolean {
    return isPostgresUniqueViolation(e);
  }

  /**
   * Paged list with optional filters. All filters are composable.
   * Uses `sql` free dynamic fragments so the query plan stays stable
   * (indexes on `context`, GIN on `tags`).
   */
  async listRows(
    tenantId: string,
    context: string | undefined,
    limit: number,
    offset: number,
    tag?: string,
    name?: string,
  ): Promise<IAdapterRow[]> {
    const sql = await this.sqlFor(tenantId);
    const ctxFragment = context
      ? sql`AND context = ${context}`
      : sql``;
    const nameFragment = name ? sql`AND name = ${name}` : sql``;
    const tagFragment = tag
      ? sql`AND ${tag} = ANY(tags) AND tags IS NOT NULL`
      : sql``;

    return sql<IAdapterRow[]>`
      SELECT * FROM http_adapters
      WHERE TRUE
        ${ctxFragment}
        ${nameFragment}
        ${tagFragment}
      ORDER BY created_at ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  /**
   * Finds the internal-adapter mirror for a service name. At most one
   * row exists due to the `name` uniqueness constraint within a tenant's DB.
   */
  async findInternalMirror(
    tenantId: string,
    serviceName: string,
    managedBy: string,
  ): Promise<IAdapterRow | null> {
    const sql = await this.sqlFor(tenantId);
    const [row] = await sql<IAdapterRow[]>`
      SELECT * FROM http_adapters
      WHERE name = ${serviceName}
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

    const sql = await this.sqlFor(tenantId);
    const [existing] = await sql<IAdapterRow[]>`
      SELECT * FROM http_adapters
      WHERE name = ${serviceName}
      LIMIT 1
    `;

    if (existing) {
      if (existing.managed_by && existing.managed_by !== managedBy) {
        throw new Error(
          `Adapter '${serviceName}' for tenant '${tenantId}' is managed by '${existing.managed_by}'`,
        );
      }
      const [updated] = await sql<IAdapterRow[]>`
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
    const [row] = await sql<IAdapterRow[]>`
      INSERT INTO http_adapters (
        id, name, context, base_url, auth_type,
        timeout_ms, max_retries, retry_backoff_ms,
        health_check_path, status, managed_by
      )
      VALUES (
        ${id}, ${serviceName}, 'internal', ${baseUrl}, 'none',
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
    const sql = await this.sqlFor(tenantId);
    const result = await sql`
      DELETE FROM http_adapters
      WHERE name = ${serviceName}
        AND managed_by = ${managedBy}
    `;
    return result.count;
  }

  /** All internal mirrors for a tenant (used by backfill/diagnostics). */
  async listMirrorsByTenant(
    tenantId: string,
    managedBy: string,
  ): Promise<IAdapterRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IAdapterRow[]>`
      SELECT * FROM http_adapters
      WHERE managed_by = ${managedBy}
      ORDER BY created_at ASC
    `;
  }

  async listEndpointsForAdapters(
    tenantId: string,
    adapterIds: string[],
  ): Promise<IEndpointRow[]> {
    if (adapterIds.length === 0) return [];
    const sql = await this.sqlFor(tenantId);
    return sql<IEndpointRow[]>`
      SELECT * FROM adapter_endpoints
      WHERE adapter_id = ANY(${adapterIds})
      ORDER BY created_at ASC
    `;
  }

  async getAdapterRow(tenantId: string, id: string): Promise<IAdapterRow | null> {
    const sql = await this.sqlFor(tenantId);
    const [row] = await sql<IAdapterRow[]>`
      SELECT * FROM http_adapters
      WHERE id = ${id}
    `;
    return row ?? null;
  }

  async listEndpointsForAdapter(
    tenantId: string,
    adapterId: string,
  ): Promise<IEndpointRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IEndpointRow[]>`
      SELECT * FROM adapter_endpoints
      WHERE adapter_id = ${adapterId}
      ORDER BY created_at ASC
    `;
  }

  async adapterExists(tenantId: string, id: string): Promise<boolean> {
    const sql = await this.sqlFor(tenantId);
    const [existing] = await sql<{ id: string }[]>`
      SELECT id FROM http_adapters
      WHERE id = ${id}
    `;
    return Boolean(existing);
  }

  async updateAdapter(
    tenantId: string,
    id: string,
    dto: UpdateAdapterDto,
  ): Promise<void> {
    const sql = await this.sqlFor(tenantId);

    if (dto.name !== undefined) {
      await sql`UPDATE http_adapters SET name = ${dto.name}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (dto.baseUrl !== undefined) {
      await sql`UPDATE http_adapters SET base_url = ${dto.baseUrl}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (dto.authType !== undefined) {
      await sql`UPDATE http_adapters SET auth_type = ${dto.authType}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (dto.authConfig !== undefined) {
      await sql`UPDATE http_adapters SET auth_config = ${sql.json(dto.authConfig as never)}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (dto.headers !== undefined) {
      await sql`UPDATE http_adapters SET headers = ${sql.json(dto.headers as never)}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (dto.timeoutMs !== undefined) {
      await sql`UPDATE http_adapters SET timeout_ms = ${dto.timeoutMs}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (dto.maxRetries !== undefined) {
      await sql`UPDATE http_adapters SET max_retries = ${dto.maxRetries}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (dto.retryBackoffMs !== undefined) {
      await sql`UPDATE http_adapters SET retry_backoff_ms = ${dto.retryBackoffMs}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (dto.healthCheckPath !== undefined) {
      await sql`UPDATE http_adapters SET health_check_path = ${dto.healthCheckPath}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (dto.status !== undefined) {
      await sql`UPDATE http_adapters SET status = ${dto.status}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (dto.tags !== undefined) {
      await sql`UPDATE http_adapters SET tags = ${dto.tags}, updated_at = NOW() WHERE id = ${id}`;
    }
    if (dto.defaultCache !== undefined) {
      await sql`
        UPDATE http_adapters
        SET default_cache_strategy = ${
          dto.defaultCache === null
            ? null
            : sql.json(dto.defaultCache as never)
        }, updated_at = NOW()
        WHERE id = ${id}
      `;
    }
  }

  async deleteAdapter(tenantId: string, id: string): Promise<number> {
    const sql = await this.sqlFor(tenantId);
    const result = await sql`
      DELETE FROM http_adapters
      WHERE id = ${id}
    `;
    return result.count;
  }

  async insertEndpoint(
    tenantId: string,
    adapterId: string,
    dto: CreateEndpointDto,
  ): Promise<IEndpointRow> {
    const sql = await this.sqlFor(tenantId);
    return this.insertOneEndpointRow(sql, adapterId, dto);
  }

  async getEndpointRow(
    tenantId: string,
    adapterId: string,
    endpointId: string,
  ): Promise<IEndpointRow | null> {
    const sql = await this.sqlFor(tenantId);
    const [row] = await sql<IEndpointRow[]>`
      SELECT * FROM adapter_endpoints
      WHERE id = ${endpointId} AND adapter_id = ${adapterId}
    `;
    return row ?? null;
  }

  async updateEndpoint(
    tenantId: string,
    adapterId: string,
    endpointId: string,
    dto: UpdateEndpointDto,
  ): Promise<void> {
    const sql = await this.sqlFor(tenantId);
    if (dto.label !== undefined) {
      await sql`
        UPDATE adapter_endpoints
        SET label = ${dto.label}
        WHERE id = ${endpointId} AND adapter_id = ${adapterId}
      `;
    }
    if (dto.method !== undefined) {
      await sql`
        UPDATE adapter_endpoints
        SET method = ${dto.method}
        WHERE id = ${endpointId} AND adapter_id = ${adapterId}
      `;
    }
    if (dto.path !== undefined) {
      await sql`
        UPDATE adapter_endpoints
        SET path = ${dto.path}
        WHERE id = ${endpointId} AND adapter_id = ${adapterId}
      `;
    }
    if (dto.cache !== undefined) {
      await sql`
        UPDATE adapter_endpoints
        SET cache_strategy = ${
          dto.cache === null ? null : sql.json(dto.cache as never)
        }
        WHERE id = ${endpointId} AND adapter_id = ${adapterId}
      `;
    }
  }

  async deleteEndpoint(
    tenantId: string,
    adapterId: string,
    endpointId: string,
  ): Promise<number> {
    const sql = await this.sqlFor(tenantId);
    const result = await sql`
      DELETE FROM adapter_endpoints
      WHERE id = ${endpointId} AND adapter_id = ${adapterId}
    `;
    return result.count;
  }

  private async insertEndpoints(
    sql: Sql,
    adapterId: string,
    dtos: CreateEndpointDto[],
  ): Promise<IEndpointRow[]> {
    const rows: IEndpointRow[] = [];
    for (const dto of dtos) {
      rows.push(await this.insertOneEndpointRow(sql, adapterId, dto));
    }
    return rows;
  }

  private async insertOneEndpointRow(
    sql: Sql,
    adapterId: string,
    dto: CreateEndpointDto,
  ): Promise<IEndpointRow> {
    const epId = generateId();
    const [row] = await sql<IEndpointRow[]>`
      INSERT INTO adapter_endpoints
        (id, adapter_id, label, method, path, cache_strategy)
      VALUES (
        ${epId},
        ${adapterId},
        ${dto.label},
        ${dto.method},
        ${dto.path},
        ${dto.cache ? sql.json(dto.cache as never) : null}
      )
      RETURNING *
    `;
    return row!;
  }
}
