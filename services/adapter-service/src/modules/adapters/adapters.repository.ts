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
  created_at: string;
  updated_at: string;
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

  async listRows(
    tenantId: string,
    context: string | undefined,
    limit: number,
    offset: number,
    tag?: string,
  ): Promise<IAdapterRow[]> {
    let query = this.sql<IAdapterRow[]>`SELECT * FROM http_adapters WHERE tenant_id = ${tenantId}`;
    
    if (context) {
      query = query.append(this.sql` AND context = ${context}`);
    }
    
    if (tag) {
      query = query.append(this.sql` AND ${tag} = ANY(tags) AND tags IS NOT NULL`);
    }
    
    return query.append(this.sql` ORDER BY created_at ASC LIMIT ${limit} OFFSET ${offset}`);
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
      WHERE id = $1 AND tenant_id = $2
    `([id, tenantId]);
    return Boolean(existing);
  }

  async updateAdapter(
    tenantId: string,
    id: string,
    dto: UpdateAdapterDto,
  ): Promise<void> {
    const updates: string[] = [];
    const values: (string | number | boolean | null)[] = [];

    // Safe field mapping - only allow predefined columns
    const safeFields: Record<string, string> = {
      name: "name",
      context: "context", 
      baseUrl: "base_url",
      authType: "auth_type",
      authConfig: "auth_config",
      headers: "headers",
      timeoutMs: "timeout_ms",
      maxRetries: "max_retries",
      retryBackoffMs: "retry_backoff_ms",
      healthCheckPath: "health_check_path",
      status: "status",
      tags: "tags",
    };

    for (const [dtoKey, dbColumn] of Object.entries(safeFields)) {
      const value = (dto as Record<string, unknown>)[dtoKey];
      if (value !== undefined) {
        updates.push(`${dbColumn} = $${updates.length + 3}`);
        
        // Safe serialization
        if (Array.isArray(value)) {
          values.push(JSON.stringify(value));
        } else if (typeof value === "object" && value !== null) {
          values.push(JSON.stringify(value));
        } else {
          values.push(value as string | number | boolean | null);
        }
      }
    }

    if (updates.length === 0) return;

    const setClause = updates.join(", ");

    await this.sql`
      UPDATE http_adapters 
      SET ${setClause}, updated_at = NOW() 
      WHERE id = $1 AND tenant_id = $2
    `([id, tenantId, ...values]);
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
