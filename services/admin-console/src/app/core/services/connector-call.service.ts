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

// T09 of manual-loops/connectors/connection-call-inspector.md: MCP detail's
// "Recent calls" migrates from `AgentAdminService.getMcpServerUsage`'s
// bundled recent-call list to this same tracked_events feed, filtered on
// the MCP call kind and `resource=mcp/<mcpServerId>` (set by
// `event-publisher.ts` for `connector.mcp_call.completed.v1`, per
// `build-events-query.ts`'s resource-prefix note). The aggregate summary
// cards KEEP reading `getMcpServerUsage` — this method only replaces the
// recent-call ROWS.
const MCP_EVENT_TYPE = "connector.mcp_call.completed.v1";
const MCP_RESOURCE_PREFIX = "mcp/";

// T10 of manual-loops/connectors/connection-call-inspector.md: agent
// detail's "Recent executions" feeds off the SAME tracked_events endpoint,
// filtered to the agent-execution lifecycle kind and the `agent/<agentId>`
// query-level alias (T05 addendum, `build-events-query.ts`'s
// `AGENT_RESOURCE_PREFIX` — matched against the payload's `agentId` field,
// NOT `envelope->>'resource'`). The full type string is verified against
// `build-events-query.ts`'s own doc comments (T06), which cite it verbatim:
// `io.yoizen.platform.runtime.execution_completed.v1`.
const AGENT_EXECUTION_EVENT_TYPE =
  "io.yoizen.platform.runtime.execution_completed.v1";
const AGENT_RESOURCE_PREFIX = "agent/";

// T11 of manual-loops/connectors/connection-call-inspector.md: the hosted
// services detail page's "Recent calls" feeds off the SAME tracked_events
// endpoint the HTTP connector detail page uses (`connector.endpoint_call.
// completed.v1`, T01), filtered to `resource=service/<serviceName>` instead
// of `adapter/<adapterId>` — `service-call.activity.ts`'s `emitServiceCallEvent`
// sets `resource: \`service/${serviceName}\`` where `serviceName` is
// `args.serviceSlug ?? args.serviceId` (the registered service's `name`
// slug, NOT its `id` UUID — callers must pass the service's `name`).
const SERVICE_RESOURCE_PREFIX = "service/";

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
  /** The `endpoint_call_completed` event's id — carried through so a consumer
   * (T09's run-view HTTP-payload section) can fetch THIS event's payload via
   * the trace payload endpoint. Undefined when the projection omits it. */
  readonly eventId?: string;
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
  /** `connector.mcp_call.completed.v1` only (T06/T09). */
  readonly payload_tool_name?: string | null;
  readonly payload_success?: boolean | string | null;
  readonly payload_error?: string | null;
  /** `io.yoizen.platform.runtime.execution_completed.v1` only (T06/T10). */
  readonly payload_state?: string | null;
  readonly payload_model?: string | null;
  readonly payload_cost_usd?: number | string | null;
}

/** One row of the T09 MCP "Recent calls" tracked_events feed —
 * `connector.mcp_call.completed.v1`, scalar-only (mirrors
 * `IMcpUsageRecentCall`'s fields plus the tracking-chain identifiers the
 * inspector and "View trace" link need). */
export interface IMcpCall {
  readonly mcpServerId: string;
  readonly toolName: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly error: string | null;
  readonly timestamp: string;
  readonly correlationId?: string;
  readonly eventId?: string;
}

/** One row of the T10 agent "Recent executions" tracked_events feed —
 * `io.yoizen.platform.runtime.execution_completed.v1`, scalar-only (state,
 * model, duration, cost, occurred_at, plus the tracking-chain identifiers
 * the inspector and "View trace" link need). */
export interface IAgentExecutionCall {
  readonly agentId: string;
  readonly state: string | null;
  readonly model: string | null;
  readonly durationMs: number | null;
  readonly costUsd: number | null;
  readonly timestamp: string;
  readonly correlationId?: string;
  readonly eventId?: string;
}

/** One row of the T11 hosted-service "Recent calls" tracked_events feed —
 * `connector.endpoint_call.completed.v1` with `resource=service/<name>`,
 * scalar-only (same shape as {@link IConnectorCall}, renamed for the
 * hosted-service caller's clarity — mirrors `IMcpCall`/`IAgentExecutionCall`
 * having their own dedicated interfaces rather than reusing `IConnectorCall`
 * verbatim). */
export interface IServiceCall {
  readonly serviceName: string;
  readonly method: string;
  readonly resolvedUrl: string;
  readonly status: number;
  readonly durationMs: number;
  readonly cacheResult: ConnectorCacheResult;
  readonly timestamp: string;
  readonly correlationId?: string;
  readonly eventId?: string;
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

  /**
   * Returns recent MCP tool calls for a given server, server-side filtered
   * by `resource=mcp/<mcpServerId>` (T09). Same window/limit defaults as
   * {@link recentCalls}.
   * @param mcpServerId  MCP server to filter on.
   * @param windowMin    How many minutes back to search (default 7 days).
   * @param limit        Max rows to return (default 20).
   */
  recentMcpCalls(
    mcpServerId: string,
    windowMin = DEFAULT_WINDOW_MIN,
    limit = 20
  ): Observable<IMcpCall[]> {
    const from = new Date(Date.now() - windowMin * 60_000).toISOString();
    const params = new HttpParams()
      .set("type", MCP_EVENT_TYPE)
      .set("resource", `${MCP_RESOURCE_PREFIX}${mcpServerId}`)
      .set("from", from)
      .set("limit", String(limit));

    return this.http
      .get<ITrackingEventsResponse>(`${TRACKING}/events`, { params })
      .pipe(
        map((res) =>
          (res.events ?? []).map((row) => toMcpCall(row, mcpServerId))
        )
      );
  }

  /**
   * Returns recent agent executions for a given agent, server-side filtered
   * by `resource=agent/<agentId>` (T10 — the query-level alias documented in
   * `build-events-query.ts`, matched against the payload's `agentId` field).
   * Same window/limit defaults as {@link recentCalls}.
   * @param agentId    Agent to filter on.
   * @param windowMin  How many minutes back to search (default 7 days).
   * @param limit      Max rows to return (default 20).
   */
  recentAgentExecutions(
    agentId: string,
    windowMin = DEFAULT_WINDOW_MIN,
    limit = 20
  ): Observable<IAgentExecutionCall[]> {
    const from = new Date(Date.now() - windowMin * 60_000).toISOString();
    const params = new HttpParams()
      .set("type", AGENT_EXECUTION_EVENT_TYPE)
      .set("resource", `${AGENT_RESOURCE_PREFIX}${agentId}`)
      .set("from", from)
      .set("limit", String(limit));

    return this.http
      .get<ITrackingEventsResponse>(`${TRACKING}/events`, { params })
      .pipe(
        map((res) =>
          (res.events ?? []).map((row) => toAgentExecutionCall(row, agentId))
        )
      );
  }

  /**
   * Returns recent platform service calls for a given hosted service,
   * server-side filtered by `resource=service/<serviceName>` (T11). Callers
   * MUST pass the registered service's `name` (slug), not its `id` — the
   * `resource` prefix is set from `args.serviceSlug ?? args.serviceId` at
   * emission time (`service-call.activity.ts`), which resolves to the slug
   * whenever it is known. Same window/limit defaults as {@link recentCalls}.
   * @param serviceName  Hosted service `name` (slug) to filter on.
   * @param windowMin    How many minutes back to search (default 7 days).
   * @param limit        Max rows to return (default 20).
   */
  recentServiceCalls(
    serviceName: string,
    windowMin = DEFAULT_WINDOW_MIN,
    limit = 20
  ): Observable<IServiceCall[]> {
    const from = new Date(Date.now() - windowMin * 60_000).toISOString();
    const params = new HttpParams()
      .set("type", EVENT_TYPE)
      .set("resource", `${SERVICE_RESOURCE_PREFIX}${serviceName}`)
      .set("from", from)
      .set("limit", String(limit));

    return this.http
      .get<ITrackingEventsResponse>(`${TRACKING}/events`, { params })
      .pipe(
        map((res) =>
          (res.events ?? []).map((row) => toServiceCall(row, serviceName))
        )
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
    eventId: row.event_id ?? undefined,
  };
}

function toMcpCall(row: ITrackingEventRow, mcpServerId: string): IMcpCall {
  return {
    mcpServerId,
    toolName: row.payload_tool_name ?? "",
    // `->>'success'` on jsonb yields the text `"true"`/`"false"` — coerce
    // defensively so a boolean-typed row (test fixtures, future backend
    // change) still resolves correctly.
    success: row.payload_success === true || row.payload_success === "true",
    durationMs: row.payload_duration_ms ?? 0,
    error: row.payload_error ?? null,
    timestamp: row.occurred_at ?? "",
    correlationId: row.correlation_id ?? undefined,
    eventId: row.event_id ?? undefined,
  };
}

function toAgentExecutionCall(
  row: ITrackingEventRow,
  agentId: string
): IAgentExecutionCall {
  return {
    agentId,
    state: row.payload_state ?? null,
    model: row.payload_model ?? null,
    durationMs:
      row.payload_duration_ms === undefined || row.payload_duration_ms === null
        ? null
        : Number(row.payload_duration_ms),
    costUsd:
      row.payload_cost_usd === undefined || row.payload_cost_usd === null
        ? null
        : Number(row.payload_cost_usd),
    timestamp: row.occurred_at ?? "",
    correlationId: row.correlation_id ?? undefined,
    eventId: row.event_id ?? undefined,
  };
}

function toServiceCall(
  row: ITrackingEventRow,
  serviceName: string
): IServiceCall {
  return {
    serviceName,
    method: row.payload_method ?? "GET",
    resolvedUrl: row.payload_resolved_url ?? "",
    status: row.payload_http_status ?? 0,
    durationMs: row.payload_duration_ms ?? 0,
    cacheResult: normalizeCacheResult(row.payload_cache_result),
    timestamp: row.occurred_at ?? "",
    correlationId: row.correlation_id ?? undefined,
    eventId: row.event_id ?? undefined,
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
