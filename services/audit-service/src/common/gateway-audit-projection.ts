import type { Document } from "mongodb";
import type { GatewayAuditEvent } from "@yoizen/shared";

/**
 * Shared SELECT list for `gateway_audit_events` row mapping (camelCase aliases).
 * Used by Postgres list and single-row queries to avoid drift.
 */
export const GATEWAY_AUDIT_SELECT_PROJECTION = `
  request_id as "requestId",
  trace_id as "traceId",
  tenant_id as "tenantId",
  method,
  path,
  status_code as "statusCode",
  duration_ms as "durationMs",
  client_ip as "clientIp",
  user_agent as "userAgent",
  jwt_subject as "jwtSubject",
  route_type as "routeType",
  upstream_url as "upstreamUrl",
  upstream_status as "upstreamStatus",
  upstream_duration as "upstreamDuration",
  rate_limit_applied as "rateLimitApplied",
  rate_limit_remaining as "rateLimitRemaining",
  error,
  created_at
`.trim();

export interface IStoredGatewayAuditEvent extends GatewayAuditEvent {
  created_at: string;
}

interface IGatewayAuditSqlRow {
  requestId: string;
  traceId: string;
  tenantId: string | null;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  clientIp: string;
  userAgent: string;
  jwtSubject: string | null;
  routeType: GatewayAuditEvent["routeType"];
  upstreamUrl: string | null;
  upstreamStatus: number | null;
  upstreamDuration: number | null;
  rateLimitApplied: boolean;
  rateLimitRemaining: number | null;
  error: string | null;
  created_at: string | Date;
}

/** Maps a Postgres `gateway_audit_events` row to the HTTP response shape. */
export function mapGatewayAuditSqlRow(
  row: IGatewayAuditSqlRow,
): IStoredGatewayAuditEvent {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at);
  return {
    requestId: row.requestId,
    traceId: row.traceId,
    tenantId: row.tenantId,
    method: row.method,
    path: row.path,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    clientIp: row.clientIp,
    userAgent: row.userAgent,
    jwtSubject: row.jwtSubject,
    routeType: row.routeType,
    upstream:
      row.upstreamUrl !== null && row.upstreamUrl !== undefined
        ? {
            url: row.upstreamUrl,
            statusCode: Number(row.upstreamStatus ?? 0),
            durationMs: Number(row.upstreamDuration ?? 0),
          }
        : undefined,
    rateLimitApplied: row.rateLimitApplied,
    rateLimitRemaining: row.rateLimitRemaining ?? undefined,
    error: row.error ?? undefined,
    timestamp: createdAt,
    created_at: createdAt,
  };
}

function readDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return new Date().toISOString();
}

/**
 * Maps a Mongo `gateway_audit_events` document to the HTTP response shape.
 */
export function mapGatewayAuditDoc(
  doc: Document,
): IStoredGatewayAuditEvent {
  const upstreamUrl = doc.upstream_url as string | null | undefined;
  const upstreamStatus = doc.upstream_status as number | null | undefined;
  const upstreamDuration = doc.upstream_duration as number | null | undefined;

  return {
    requestId: String(doc._id ?? doc.request_id ?? ""),
    traceId: String(doc.trace_id ?? ""),
    tenantId: (doc.tenant_id as string | null | undefined) ?? null,
    method: String(doc.method ?? ""),
    path: String(doc.path ?? ""),
    statusCode: Number(doc.status_code ?? 0),
    durationMs: Number(doc.duration_ms ?? 0),
    clientIp: String(doc.client_ip ?? ""),
    userAgent: String(doc.user_agent ?? ""),
    jwtSubject: (doc.jwt_subject as string | null | undefined) ?? null,
    routeType: (doc.route_type as GatewayAuditEvent["routeType"]) ?? "platform",
    upstream:
      upstreamUrl !== undefined && upstreamUrl !== null
        ? {
            url: upstreamUrl,
            statusCode: Number(upstreamStatus ?? 0),
            durationMs: Number(upstreamDuration ?? 0),
          }
        : undefined,
    rateLimitApplied: Boolean(doc.rate_limit_applied),
    rateLimitRemaining:
      (doc.rate_limit_remaining as number | null | undefined) ?? undefined,
    error: (doc.error as string | undefined) ?? undefined,
    timestamp: readDate(doc.created_at),
    created_at: readDate(doc.created_at),
  };
}
