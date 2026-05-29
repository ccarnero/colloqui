import type {
  AdapterCacheStrategy,
  AdapterStatusValue,
} from "@yoizen/shared";
import type {
  CreateAdapterDto,
  UpdateAdapterDto,
  CreateEndpointDto,
  UpdateEndpointDto,
} from "./adapters.dto";

export const ADAPTERS_REPOSITORY = Symbol("ADAPTERS_REPOSITORY");

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

function parseJsonField<T>(value: T | string, fallback: T): T {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function mapAdapter(row: IAdapterRow, tenantId: string) {
  return {
    id: row.id,
    tenantId,
    name: row.name,
    context: row.context,
    baseUrl: row.base_url,
    authType: row.auth_type,
    authConfig: parseJsonField(row.auth_config, {}),
    headers: parseJsonField(row.headers, []),
    defaultCache: parseJsonField(row.default_cache_strategy, null),
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
    cache: parseJsonField(row.cache_strategy, null),
    createdAt: row.created_at,
  };
}

export interface IAdaptersRepository {
  insertAdapterWithEndpoints(
    tenantId: string,
    dto: CreateAdapterDto,
  ): Promise<{ row: IAdapterRow; endpoints: IEndpointRow[] }>;
  isUniqueViolation(e: unknown): boolean;
  listRows(
    tenantId: string,
    context: string | undefined,
    limit: number,
    offset: number,
    tag?: string,
    name?: string,
  ): Promise<IAdapterRow[]>;
  findInternalMirror(
    tenantId: string,
    serviceName: string,
    managedBy: string,
  ): Promise<IAdapterRow | null>;
  upsertMirror(params: IUpsertMirrorParams): Promise<IAdapterRow>;
  deleteMirrorByServiceName(
    tenantId: string,
    serviceName: string,
    managedBy: string,
  ): Promise<number>;
  listMirrorsByTenant(
    tenantId: string,
    managedBy: string,
  ): Promise<IAdapterRow[]>;
  listEndpointsForAdapters(
    tenantId: string,
    adapterIds: string[],
  ): Promise<IEndpointRow[]>;
  getAdapterRow(tenantId: string, id: string): Promise<IAdapterRow | null>;
  listEndpointsForAdapter(
    tenantId: string,
    adapterId: string,
  ): Promise<IEndpointRow[]>;
  adapterExists(tenantId: string, id: string): Promise<boolean>;
  updateAdapter(
    tenantId: string,
    id: string,
    dto: UpdateAdapterDto,
  ): Promise<void>;
  deleteAdapter(tenantId: string, id: string): Promise<number>;
  insertEndpoint(
    tenantId: string,
    adapterId: string,
    dto: CreateEndpointDto,
  ): Promise<IEndpointRow>;
  getEndpointRow(
    tenantId: string,
    adapterId: string,
    endpointId: string,
  ): Promise<IEndpointRow | null>;
  updateEndpoint(
    tenantId: string,
    adapterId: string,
    endpointId: string,
    dto: UpdateEndpointDto,
  ): Promise<void>;
  deleteEndpoint(
    tenantId: string,
    adapterId: string,
    endpointId: string,
  ): Promise<number>;
}
