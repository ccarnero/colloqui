import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { map, type Observable } from "rxjs";
import { environment } from "../../../environments/environment";

const AUDIT = `${environment.apiUrl}/audit`;
const EVENT_TYPE = "connector.endpoint_call.completed.v1";
/** Fetch more than we need so client-side filter by adapterId doesn't under-deliver. */
const FETCH_LIMIT = 200;

const CONNECTOR_CACHE_RESULT = {
  HIT: "hit",
  MISS: "miss",
  BYPASS: "bypass",
} as const;

export type ConnectorCacheResult =
  | (typeof CONNECTOR_CACHE_RESULT)[keyof typeof CONNECTOR_CACHE_RESULT]
  | null;

export interface IConnectorCall {
  readonly adapterId: string;
  readonly endpointId: string | null;
  readonly method: string;
  readonly resolvedUrl: string;
  readonly status: number;
  readonly durationMs: number;
  readonly cacheResult: ConnectorCacheResult;
  readonly timestamp: string;
  readonly correlationId?: string;
  readonly requestHeaders?: Record<string, string>;
  readonly requestBody?: unknown;
  readonly responseHeaders?: Record<string, string>;
  readonly responseBody?: unknown;
  readonly cacheKey?: string;
  readonly cacheTtlSeconds?: number;
}

interface IAuditListResponse {
  events?: AuditRow[];
}

type AuditRow = Record<string, unknown>;

@Injectable({ providedIn: "root" })
export class ConnectorCallService {
  private readonly http = inject(HttpClient);

  /**
   * Returns recent endpoint calls for a given adapter, client-side filtered.
   * @param adapterId  Adapter to filter on.
   * @param windowMin  How many minutes back to search (default 60).
   * @param limit      Max rows to return after client-side filter (default 20).
   */
  recentCalls(
    adapterId: string,
    windowMin = 60,
    limit = 20
  ): Observable<IConnectorCall[]> {
    const from = new Date(Date.now() - windowMin * 60_000).toISOString();
    const params = new HttpParams()
      .set("type", EVENT_TYPE)
      .set("from", from)
      .set("limit", String(FETCH_LIMIT));

    return this.http
      .get<IAuditListResponse>(`${AUDIT}/events`, { params })
      .pipe(
        map((res) =>
          (res.events ?? [])
            .map(toCall)
            .filter(
              (c): c is IConnectorCall =>
                c !== null && c.adapterId === adapterId
            )
            .slice(0, limit)
        )
      );
  }
}

function toCall(row: AuditRow): IConnectorCall | null {
  const rawPayload = row["payload"];
  const payload = parsePayload(rawPayload);
  const adapterId = str(payload["adapterId"]);
  if (!adapterId) {
    return null;
  }
  return {
    adapterId,
    endpointId: str(payload["endpointId"]) || null,
    method: str(payload["method"]) || "GET",
    resolvedUrl: str(payload["resolvedUrl"]),
    status: num(payload["status"]),
    durationMs: num(payload["durationMs"]),
    cacheResult: normalizeCacheResult(payload["cacheResult"]),
    timestamp: str(row["created_at"]) || str(row["createdAt"]),
    correlationId:
      str(row["correlation_id"]) || str(row["correlationId"]) || undefined,
    requestHeaders: recordField(payload["requestHeaders"]),
    requestBody: parseBodyField(payload["requestBody"]),
    responseHeaders: recordField(payload["responseHeaders"]),
    responseBody: parseBodyField(payload["responseBody"]),
    cacheKey: str(payload["cacheKey"]) || undefined,
    cacheTtlSeconds:
      typeof payload["cacheTtlSeconds"] === "number"
        ? payload["cacheTtlSeconds"]
        : undefined,
  };
}

function parsePayload(rawPayload: unknown): Record<string, unknown> {
  if (typeof rawPayload === "string") {
    try {
      const parsed = JSON.parse(rawPayload) as unknown;
      return recordFieldUnknown(parsed) ?? {};
    } catch {
      return {};
    }
  }
  return recordFieldUnknown(rawPayload) ?? {};
}

function normalizeCacheResult(v: unknown): ConnectorCacheResult {
  const value = str(v).toLowerCase();
  if (
    value === CONNECTOR_CACHE_RESULT.HIT ||
    value === CONNECTOR_CACHE_RESULT.MISS ||
    value === CONNECTOR_CACHE_RESULT.BYPASS
  ) {
    return value;
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function parseBodyField(v: unknown): unknown {
  if (typeof v !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function recordField(v: unknown): Record<string, string> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, string>)
    : undefined;
}

function recordFieldUnknown(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
