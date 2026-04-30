/**
 * Shared SELECT list for `gateway_audit_events` row mapping (camelCase aliases).
 * Used by list and single-row queries to avoid drift.
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
