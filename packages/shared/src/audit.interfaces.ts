export interface GatewayAuditEvent {
  requestId: string;
  traceId: string;
  timestamp: string;
  tenantId: string | null;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  clientIp: string;
  userAgent: string;
  jwtSubject: string | null;
  routeType: 'platform' | 'dynamic';
  upstream?: GatewayAuditUpstream;
  rateLimitApplied: boolean;
  rateLimitRemaining?: number;
  error?: string;
  /** Causal chain — populated only for webhook ingress rows; NULL elsewhere. */
  correlationId?: string | null;
  causationId?: string | null;
  depth?: number | null;
}

export interface GatewayAuditUpstream {
  url: string;
  statusCode: number;
  durationMs: number;
}
