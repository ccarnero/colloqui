import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { map, type Observable } from "rxjs";
import { environment } from "../../../environments/environment";

// T04 of manual-loops/connector-trace-linking.md: reads the durable causal
// store (`tracking.tracked_events`) via the gateway's `GET /tracking/events`
// route (proxying the ingester's T03 `GET /events`) instead of
// audit-service's 60-minute window.
const TRACKING = `${environment.apiUrl}/tracking`;
const EVENT_TYPE = "connector.endpoint_call.completed.v1";
/** `envelope->>'resource'` shape set by
 * `connector-runtime/src/activities/_shared/event-publisher.ts`
 * (`resource: \`adapter/${adapterId}\``). */
const RESOURCE_PREFIX = "adapter/";
/** Default lookback window: 7 days (was 60 minutes under audit-service). */
const DEFAULT_WINDOW_MIN = 7 * 24 * 60;

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

/** `GET /tracking/events` row shape (verified live). Payload bodies are
 * NEVER present here (by design — payload viewing stays in the trace
 * console, `tracking-chain.service.ts`'s `getEventPayload`). */
interface ITrackingEventRow {
  readonly event_id?: string;
  readonly correlation_id?: string | null;
  readonly connector_id?: string | null;
  readonly occurred_at?: string;
  readonly payload_method?: string | null;
  readonly payload_resolved_url?: string | null;
  readonly payload_http_status?: number | null;
  readonly payload_duration_ms?: number | null;
  readonly payload_cache_result?: string | null;
}

interface ITrackingEventsResponse {
  readonly events?: ITrackingEventRow[];
}

@Injectable({ providedIn: "root" })
export class ConnectorCallService {
  private readonly http = inject(HttpClient);

  /**
   * Returns recent endpoint calls for a given adapter, server-side filtered
   * by `resource=adapter/<adapterId>`.
   * @param adapterId  Adapter to filter on.
   * @param windowMin  How many minutes back to search (default 7 days).
   * @param limit      Max rows to return (default 20).
   */
  recentCalls(
    adapterId: string,
    windowMin = DEFAULT_WINDOW_MIN,
    limit = 20
  ): Observable<IConnectorCall[]> {
    const from = new Date(Date.now() - windowMin * 60_000).toISOString();
    const params = new HttpParams()
      .set("type", EVENT_TYPE)
      .set("resource", `${RESOURCE_PREFIX}${adapterId}`)
      .set("from", from)
      .set("limit", String(limit));

    return this.http
      .get<ITrackingEventsResponse>(`${TRACKING}/events`, { params })
      .pipe(
        map((res) => (res.events ?? []).map((row) => toCall(row, adapterId)))
      );
  }
}

function toCall(row: ITrackingEventRow, adapterId: string): IConnectorCall {
  return {
    adapterId: row.connector_id ?? adapterId,
    // `endpointId` is not present in the tracked-events projection
    // (`build-events-query.ts`'s `EventRow`) — never available from this
    // endpoint.
    endpointId: null,
    method: row.payload_method ?? "GET",
    resolvedUrl: row.payload_resolved_url ?? "",
    status: row.payload_http_status ?? 0,
    durationMs: row.payload_duration_ms ?? 0,
    cacheResult: normalizeCacheResult(row.payload_cache_result),
    timestamp: row.occurred_at ?? "",
    correlationId: row.correlation_id ?? undefined,
  };
}

function normalizeCacheResult(
  v: string | null | undefined
): ConnectorCacheResult {
  const value = (v ?? "").toLowerCase();
  if (
    value === CONNECTOR_CACHE_RESULT.HIT ||
    value === CONNECTOR_CACHE_RESULT.MISS ||
    value === CONNECTOR_CACHE_RESULT.BYPASS
  ) {
    return value;
  }
  return null;
}
