import { Inject, Injectable } from "@nestjs/common";
import type { Document, Filter, WithId } from "mongodb";
import type { Db, MongoClient } from "@yoizen/database";
import {
  AdapterStatus,
  generateId,
  type AdapterCacheStrategy,
  type AdapterStatusValue,
} from "@yoizen/shared";
import {
  isMongoDuplicateKeyError,
  type IStringIdDoc,
  type TenantMongoConnectionManager,
} from "@yoizen/database";
import { AdapterTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  CreateAdapterDto,
  UpdateAdapterDto,
  CreateEndpointDto,
  UpdateEndpointDto,
} from "./adapters.dto";
import type {
  IAdapterRow,
  IAdaptersRepository,
  IEndpointRow,
  IUpsertMirrorParams,
} from "./adapters.repository.interface";

function parseJsonField<T>(value: T | string, fallback: T): T {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function docToAdapterRow(doc: WithId<IStringIdDoc>): IAdapterRow {
  return {
    id: String(doc._id),
    name: String(doc.name ?? ""),
    context: String(doc.context ?? ""),
    base_url: String(doc.base_url ?? ""),
    auth_type: String(doc.auth_type ?? "none"),
    auth_config: parseJsonField(doc.auth_config as Record<string, unknown>, {}),
    headers: parseJsonField(
      doc.headers as Array<{ key: string; value: string }>,
      [],
    ),
    default_cache_strategy: parseJsonField(
      doc.default_cache_strategy as AdapterCacheStrategy | null,
      null,
    ),
    timeout_ms: Number(doc.timeout_ms ?? 0),
    max_retries: Number(doc.max_retries ?? 0),
    retry_backoff_ms: Number(doc.retry_backoff_ms ?? 0),
    health_check_path: String(doc.health_check_path ?? "/health"),
    is_encrypted: Boolean(doc.is_encrypted),
    tags: Array.isArray(doc.tags) ? doc.tags.map((t) => String(t)) : [],
    status: String(doc.status ?? AdapterStatus.ENABLED) as AdapterStatusValue,
    managed_by:
      doc.managed_by === null || doc.managed_by === undefined
        ? null
        : String(doc.managed_by),
    created_at: toIso(doc.created_at),
    updated_at: toIso(doc.updated_at),
  };
}

function docToEndpointRow(doc: WithId<IStringIdDoc>): IEndpointRow {
  return {
    id: String(doc._id),
    adapter_id: String(doc.adapter_id ?? ""),
    label: String(doc.label ?? ""),
    method: String(doc.method ?? ""),
    path: String(doc.path ?? ""),
    cache_strategy: parseJsonField(
      doc.cache_strategy as AdapterCacheStrategy | null,
      null,
    ),
    created_at: toIso(doc.created_at),
  };
}

@Injectable()
export class AdaptersMongoRepository implements IAdaptersRepository {
  constructor(
    @Inject(AdapterTenantConnectionManager)
    private readonly connections: TenantMongoConnectionManager,
  ) {}

  private async dbFor(tenantId: string) {
    return this.connections.ensureSchema(tenantId);
  }

  async insertAdapterWithEndpoints(
    tenantId: string,
    dto: CreateAdapterDto,
  ): Promise<{ row: IAdapterRow; endpoints: IEndpointRow[] }> {
    const db = await this.dbFor(tenantId);
    const adapters = db.collection<IStringIdDoc>("http_adapters");
    const id = generateId();
    const now = new Date();
    const authType = dto.authType ?? "none";
    const doc = {
      _id: id,
      name: dto.name,
      context: dto.context,
      base_url: dto.baseUrl ?? "",
      auth_type: authType,
      auth_config: dto.authConfig ?? {},
      headers: dto.headers ?? [],
      default_cache_strategy: dto.defaultCache ?? null,
      timeout_ms: dto.timeoutMs ?? 5000,
      max_retries: dto.maxRetries ?? 3,
      retry_backoff_ms: dto.retryBackoffMs ?? 1000,
      health_check_path: dto.healthCheckPath ?? "/health",
      status: AdapterStatus.ENABLED,
      is_encrypted: false,
      tags: dto.tags ?? [],
      managed_by: null,
      created_at: now,
      updated_at: now,
    };
    await adapters.insertOne(doc);

    let endpoints: IEndpointRow[] = [];
    if (dto.endpoints?.length) {
      endpoints = await this.insertEndpoints(db, id, dto.endpoints);
    }
    return { row: docToAdapterRow(doc as WithId<IStringIdDoc>), endpoints };
  }

  isUniqueViolation(e: unknown): boolean {
    return isMongoDuplicateKeyError(e);
  }

  async listRows(
    tenantId: string,
    context: string | undefined,
    limit: number,
    offset: number,
    tag?: string,
    name?: string,
  ): Promise<IAdapterRow[]> {
    const db = await this.dbFor(tenantId);
    const filter: Filter<IStringIdDoc> = {};
    if (context) filter.context = context;
    if (name) filter.name = name;
    if (tag) filter.tags = tag;

    const docs = await db
      .collection<IStringIdDoc>("http_adapters")
      .find(filter)
      .sort({ created_at: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return docs.map((doc) => docToAdapterRow(doc));
  }

  async findInternalMirror(
    tenantId: string,
    serviceName: string,
    managedBy: string,
  ): Promise<IAdapterRow | null> {
    const db = await this.dbFor(tenantId);
    const doc = await db.collection<IStringIdDoc>("http_adapters").findOne({
      name: serviceName,
      managed_by: managedBy,
    });
    return doc ? docToAdapterRow(doc) : null;
  }

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

    const db = await this.dbFor(tenantId);
    const col = db.collection<IStringIdDoc>("http_adapters");
    const existing = await col.findOne({ name: serviceName });

    if (existing?.managed_by && existing.managed_by !== managedBy) {
      throw new Error(
        `Adapter '${serviceName}' for tenant '${tenantId}' is managed by '${existing.managed_by}'`,
      );
    }

    const now = new Date();
    const result = await col.findOneAndUpdate(
      { name: serviceName },
      {
        $set: {
          base_url: baseUrl,
          health_check_path: healthCheckPath,
          status,
          managed_by: managedBy,
          updated_at: now,
        },
        $setOnInsert: {
          _id: generateId(),
          name: serviceName,
          context: "internal",
          auth_type: "none",
          auth_config: {},
          headers: [],
          default_cache_strategy: null,
          timeout_ms: timeoutMs,
          max_retries: maxRetries,
          retry_backoff_ms: retryBackoffMs,
          is_encrypted: false,
          tags: [],
          created_at: now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    if (!result) {
      throw new Error(`upsertMirror failed for '${serviceName}'`);
    }
    return docToAdapterRow(result);
  }

  async deleteMirrorByServiceName(
    tenantId: string,
    serviceName: string,
    managedBy: string,
  ): Promise<number> {
    const db = await this.dbFor(tenantId);
    const result = await db.collection<IStringIdDoc>("http_adapters").deleteOne({
      name: serviceName,
      managed_by: managedBy,
    });
    return result.deletedCount;
  }

  async listMirrorsByTenant(
    tenantId: string,
    managedBy: string,
  ): Promise<IAdapterRow[]> {
    const db = await this.dbFor(tenantId);
    const docs = await db
      .collection<IStringIdDoc>("http_adapters")
      .find({ managed_by: managedBy })
      .sort({ created_at: 1 })
      .toArray();
    return docs.map((doc) => docToAdapterRow(doc));
  }

  async listEndpointsForAdapters(
    tenantId: string,
    adapterIds: string[],
  ): Promise<IEndpointRow[]> {
    if (adapterIds.length === 0) return [];
    const db = await this.dbFor(tenantId);
    const docs = await db
      .collection<IStringIdDoc>("adapter_endpoints")
      .find({ adapter_id: { $in: adapterIds } })
      .sort({ created_at: 1 })
      .toArray();
    return docs.map((doc) => docToEndpointRow(doc));
  }

  async getAdapterRow(tenantId: string, id: string): Promise<IAdapterRow | null> {
    const db = await this.dbFor(tenantId);
    const doc = await db.collection<IStringIdDoc>("http_adapters").findOne({ _id: id });
    return doc ? docToAdapterRow(doc) : null;
  }

  async adapterExists(tenantId: string, id: string): Promise<boolean> {
    const db = await this.dbFor(tenantId);
    const count = await db
      .collection<IStringIdDoc>("http_adapters")
      .countDocuments({ _id: id }, { limit: 1 });
    return count > 0;
  }

  async listEndpointsForAdapter(
    tenantId: string,
    adapterId: string,
  ): Promise<IEndpointRow[]> {
    const db = await this.dbFor(tenantId);
    const docs = await db
      .collection<IStringIdDoc>("adapter_endpoints")
      .find({ adapter_id: adapterId })
      .sort({ created_at: 1 })
      .toArray();
    return docs.map((doc) => docToEndpointRow(doc));
  }

  async updateAdapter(
    tenantId: string,
    id: string,
    dto: UpdateAdapterDto,
  ): Promise<void> {
    const db = await this.dbFor(tenantId);
    const setFields: Document = { updated_at: new Date() };

    if (dto.name !== undefined) setFields.name = dto.name;
    if (dto.baseUrl !== undefined) setFields.base_url = dto.baseUrl;
    if (dto.authType !== undefined) setFields.auth_type = dto.authType;
    if (dto.authConfig !== undefined) setFields.auth_config = dto.authConfig;
    if (dto.headers !== undefined) setFields.headers = dto.headers;
    if (dto.timeoutMs !== undefined) setFields.timeout_ms = dto.timeoutMs;
    if (dto.maxRetries !== undefined) setFields.max_retries = dto.maxRetries;
    if (dto.retryBackoffMs !== undefined) {
      setFields.retry_backoff_ms = dto.retryBackoffMs;
    }
    if (dto.healthCheckPath !== undefined) {
      setFields.health_check_path = dto.healthCheckPath;
    }
    if (dto.status !== undefined) setFields.status = dto.status;
    if (dto.tags !== undefined) setFields.tags = dto.tags;
    if (dto.defaultCache !== undefined) {
      setFields.default_cache_strategy = dto.defaultCache;
    }

    if (Object.keys(setFields).length > 1) {
      await db
        .collection<IStringIdDoc>("http_adapters")
        .updateOne({ _id: id }, { $set: setFields });
    }
  }

  async deleteAdapter(tenantId: string, id: string): Promise<number> {
    const db = await this.dbFor(tenantId);
    await db.collection<IStringIdDoc>("adapter_endpoints").deleteMany({ adapter_id: id });
    const result = await db.collection<IStringIdDoc>("http_adapters").deleteOne({ _id: id });
    return result.deletedCount;
  }

  async insertEndpoint(
    tenantId: string,
    adapterId: string,
    dto: CreateEndpointDto,
  ): Promise<IEndpointRow> {
    const db = await this.dbFor(tenantId);
    return this.insertOneEndpointRow(db, adapterId, dto);
  }

  async getEndpointRow(
    tenantId: string,
    adapterId: string,
    endpointId: string,
  ): Promise<IEndpointRow | null> {
    const db = await this.dbFor(tenantId);
    const doc = await db.collection<IStringIdDoc>("adapter_endpoints").findOne({
      _id: endpointId,
      adapter_id: adapterId,
    });
    return doc ? docToEndpointRow(doc) : null;
  }

  async updateEndpoint(
    tenantId: string,
    adapterId: string,
    endpointId: string,
    dto: UpdateEndpointDto,
  ): Promise<void> {
    const db = await this.dbFor(tenantId);
    const setFields: Document = {};
    if (dto.label !== undefined) setFields.label = dto.label;
    if (dto.method !== undefined) setFields.method = dto.method;
    if (dto.path !== undefined) setFields.path = dto.path;
    if (dto.cache !== undefined) setFields.cache_strategy = dto.cache;

    if (Object.keys(setFields).length > 0) {
      await db.collection<IStringIdDoc>("adapter_endpoints").updateOne(
        { _id: endpointId, adapter_id: adapterId },
        { $set: setFields },
      );
    }
  }

  async deleteEndpoint(
    tenantId: string,
    adapterId: string,
    endpointId: string,
  ): Promise<number> {
    const db = await this.dbFor(tenantId);
    const result = await db.collection<IStringIdDoc>("adapter_endpoints").deleteOne({
      _id: endpointId,
      adapter_id: adapterId,
    });
    return result.deletedCount;
  }

  private async insertEndpoints(
    db: Db,
    adapterId: string,
    dtos: CreateEndpointDto[],
  ): Promise<IEndpointRow[]> {
    const rows: IEndpointRow[] = [];
    for (const dto of dtos) {
      rows.push(await this.insertOneEndpointRow(db, adapterId, dto));
    }
    return rows;
  }

  private async insertOneEndpointRow(
    db: Db,
    adapterId: string,
    dto: CreateEndpointDto,
  ): Promise<IEndpointRow> {
    const endpointsCol = db.collection<IStringIdDoc>("adapter_endpoints");
    const epId = generateId();
    const doc = {
      _id: epId,
      adapter_id: adapterId,
      label: dto.label,
      method: dto.method,
      path: dto.path,
      cache_strategy: dto.cache ?? null,
      created_at: new Date(),
    };
    await endpointsCol.insertOne(doc);
    return docToEndpointRow(doc as WithId<IStringIdDoc>);
  }
}
