import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import type { Sql } from "postgres";
import { POSTGRES_SQL } from "../../providers/postgres.provider";
import type {
  CreateAdapterDto,
  UpdateAdapterDto,
  CreateEndpointDto,
} from "./adapters.dto";

interface AdapterRow {
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
  status: string;
  created_at: string;
  updated_at: string;
}

interface EndpointRow {
  id: string;
  adapter_id: string;
  label: string;
  method: string;
  path: string;
  created_at: string;
}

function generateId(): string {
  return crypto.randomUUID();
}

function parseJsonb<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function mapAdapter(row: AdapterRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    context: row.context,
    baseUrl: row.base_url,
    authType: row.auth_type,
    authConfig: parseJsonb(row.auth_config),
    headers: parseJsonb(row.headers),
    timeoutMs: row.timeout_ms,
    maxRetries: row.max_retries,
    retryBackoffMs: row.retry_backoff_ms,
    healthCheckPath: row.health_check_path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEndpoint(row: EndpointRow) {
  return {
    id: row.id,
    adapterId: row.adapter_id,
    label: row.label,
    method: row.method,
    path: row.path,
    createdAt: row.created_at,
  };
}

@Injectable()
export class AdaptersService {
  private readonly logger = new Logger(AdaptersService.name);

  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async create(tenantId: string, dto: CreateAdapterDto) {
    const id = generateId();
    const authType = dto.authType ?? "none";
    const authConfig = dto.authConfig ?? {};
    const headers = dto.headers ?? [];
    const timeoutMs = dto.timeoutMs ?? 5000;
    const maxRetries = dto.maxRetries ?? 3;
    const retryBackoffMs = dto.retryBackoffMs ?? 1000;
    const healthCheckPath = dto.healthCheckPath ?? "/health";

    try {
      const [row] = await this.sql<AdapterRow[]>`
        INSERT INTO http_adapters
          (id, tenant_id, name, context, base_url, auth_type, auth_config,
           headers, timeout_ms, max_retries, retry_backoff_ms, health_check_path)
        VALUES
          (${id}, ${tenantId}, ${dto.name}, ${dto.context}, ${dto.baseUrl},
           ${authType}, ${this.sql.json(authConfig as never)},
           ${this.sql.json(headers as never)}, ${timeoutMs},
           ${maxRetries}, ${retryBackoffMs}, ${healthCheckPath})
        RETURNING *
      `;

      let endpoints: EndpointRow[] = [];
      if (dto.endpoints?.length) {
        endpoints = await this.insertEndpoints(id, dto.endpoints);
      }

      this.logger.log(`Created adapter '${dto.name}' for tenant ${tenantId}`);
      return {
        ...mapAdapter(row),
        endpoints: endpoints.map(mapEndpoint),
      };
    } catch (e: unknown) {
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "23505"
      ) {
        throw new ConflictException(
          `Adapter '${dto.name}' already exists for this tenant`,
        );
      }
      throw e;
    }
  }

  async list(tenantId: string, context?: string) {
    const rows = context
      ? await this.sql<AdapterRow[]>`
          SELECT * FROM http_adapters
          WHERE tenant_id = ${tenantId} AND context = ${context}
          ORDER BY created_at ASC
        `
      : await this.sql<AdapterRow[]>`
          SELECT * FROM http_adapters
          WHERE tenant_id = ${tenantId}
          ORDER BY created_at ASC
        `;

    if (rows.length === 0) return [];

    const adapterIds = rows.map((r) => r.id);
    const endpoints = await this.sql<EndpointRow[]>`
      SELECT * FROM adapter_endpoints
      WHERE adapter_id = ANY(${adapterIds})
      ORDER BY created_at ASC
    `;

    const endpointsByAdapter = new Map<string, EndpointRow[]>();
    for (const ep of endpoints) {
      const list = endpointsByAdapter.get(ep.adapter_id);
      if (list) {
        list.push(ep);
      } else {
        endpointsByAdapter.set(ep.adapter_id, [ep]);
      }
    }

    return rows.map((row) => ({
      ...mapAdapter(row),
      endpoints: (endpointsByAdapter.get(row.id) ?? []).map(mapEndpoint),
    }));
  }

  async get(tenantId: string, id: string) {
    const [row] = await this.sql<AdapterRow[]>`
      SELECT * FROM http_adapters
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) {
      throw new NotFoundException(`Adapter '${id}' not found`);
    }

    const endpoints = await this.sql<EndpointRow[]>`
      SELECT * FROM adapter_endpoints
      WHERE adapter_id = ${id}
      ORDER BY created_at ASC
    `;

    return {
      ...mapAdapter(row),
      endpoints: endpoints.map(mapEndpoint),
    };
  }

  async update(tenantId: string, id: string, dto: UpdateAdapterDto) {
    const [existing] = await this.sql<AdapterRow[]>`
      SELECT id FROM http_adapters
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!existing) {
      throw new NotFoundException(`Adapter '${id}' not found`);
    }

    const sets: string[] = [];
    const values: (string | number | boolean | null)[] = [];

    const fieldMap: Record<string, string> = {
      name: "name",
      baseUrl: "base_url",
      authType: "auth_type",
      authConfig: "auth_config",
      headers: "headers",
      timeoutMs: "timeout_ms",
      maxRetries: "max_retries",
      retryBackoffMs: "retry_backoff_ms",
      healthCheckPath: "health_check_path",
      status: "status",
    };

    for (const [dtoKey, column] of Object.entries(fieldMap)) {
      const value = (dto as Record<string, unknown>)[dtoKey];
      if (value !== undefined) {
        sets.push(column);
        const serialized =
          typeof value === "object" ? JSON.stringify(value) : value;
        values.push(serialized as string | number | boolean | null);
      }
    }

    if (sets.length === 0) {
      return this.get(tenantId, id);
    }

    const setClauses = sets
      .map((col, i) => `${col} = $${i + 3}`)
      .join(", ");

    await this.sql.unsafe(
      `UPDATE http_adapters SET ${setClauses}, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId, ...values],
    );

    this.logger.log(`Updated adapter '${id}' for tenant ${tenantId}`);
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const result = await this.sql`
      DELETE FROM http_adapters
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (result.count === 0) {
      throw new NotFoundException(`Adapter '${id}' not found`);
    }
    this.logger.log(`Removed adapter '${id}' for tenant ${tenantId}`);
  }

  async addEndpoint(tenantId: string, adapterId: string, dto: CreateEndpointDto) {
    const [adapter] = await this.sql<AdapterRow[]>`
      SELECT id FROM http_adapters
      WHERE id = ${adapterId} AND tenant_id = ${tenantId}
    `;
    if (!adapter) {
      throw new NotFoundException(`Adapter '${adapterId}' not found`);
    }

    const epId = generateId();
    try {
      const [row] = await this.sql<EndpointRow[]>`
        INSERT INTO adapter_endpoints (id, adapter_id, label, method, path)
        VALUES (${epId}, ${adapterId}, ${dto.label}, ${dto.method}, ${dto.path})
        RETURNING *
      `;
      this.logger.log(
        `Added endpoint '${dto.method} ${dto.path}' to adapter ${adapterId}`,
      );
      return mapEndpoint(row);
    } catch (e: unknown) {
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "23505"
      ) {
        throw new ConflictException(
          `Endpoint '${dto.method} ${dto.path}' already exists on this adapter`,
        );
      }
      throw e;
    }
  }

  async removeEndpoint(
    tenantId: string,
    adapterId: string,
    endpointId: string,
  ): Promise<void> {
    const [adapter] = await this.sql<AdapterRow[]>`
      SELECT id FROM http_adapters
      WHERE id = ${adapterId} AND tenant_id = ${tenantId}
    `;
    if (!adapter) {
      throw new NotFoundException(`Adapter '${adapterId}' not found`);
    }

    const result = await this.sql`
      DELETE FROM adapter_endpoints
      WHERE id = ${endpointId} AND adapter_id = ${adapterId}
    `;
    if (result.count === 0) {
      throw new NotFoundException(`Endpoint '${endpointId}' not found`);
    }
    this.logger.log(`Removed endpoint '${endpointId}' from adapter ${adapterId}`);
  }

  private async insertEndpoints(
    adapterId: string,
    dtos: CreateEndpointDto[],
  ): Promise<EndpointRow[]> {
    const rows: EndpointRow[] = [];
    for (const dto of dtos) {
      const epId = generateId();
      const [row] = await this.sql<EndpointRow[]>`
        INSERT INTO adapter_endpoints (id, adapter_id, label, method, path)
        VALUES (${epId}, ${adapterId}, ${dto.label}, ${dto.method}, ${dto.path})
        RETURNING *
      `;
      rows.push(row);
    }
    return rows;
  }
}
