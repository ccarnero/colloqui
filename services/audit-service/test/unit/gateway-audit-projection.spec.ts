import { describe, it, expect } from "bun:test";
import {
  mapGatewayAuditDoc,
  mapGatewayAuditSqlRow,
  GATEWAY_AUDIT_SELECT_PROJECTION,
} from "../../src/common/gateway-audit-projection";

describe("gateway-audit-projection", () => {
  describe("GATEWAY_AUDIT_SELECT_PROJECTION", () => {
    it("includes correlation_id, causation_id, and depth columns", () => {
      expect(GATEWAY_AUDIT_SELECT_PROJECTION).toContain(
        'correlation_id as "correlationId"',
      );
      expect(GATEWAY_AUDIT_SELECT_PROJECTION).toContain(
        'causation_id as "causationId"',
      );
      expect(GATEWAY_AUDIT_SELECT_PROJECTION).toContain("depth");
    });
  });

  describe("mapGatewayAuditDoc", () => {
    const baseDoc = {
      _id: "req-1",
      trace_id: "trace-abc",
      tenant_id: "t1",
      method: "POST",
      path: "/api/webhooks/telegram/t1",
      status_code: 200,
      duration_ms: 42.5,
      client_ip: "1.2.3.4",
      user_agent: "test-agent",
      jwt_subject: null,
      route_type: "platform" as const,
      rate_limit_applied: false,
      created_at: new Date("2026-06-20T00:00:00Z"),
    };

    it("maps populated correlation/causation/depth from Mongo doc", () => {
      const doc = {
        ...baseDoc,
        correlation_id: "corr-wh",
        causation_id: null,
        depth: 0,
      };

      const result = mapGatewayAuditDoc(doc);

      expect(result.correlationId).toBe("corr-wh");
      expect(result.causationId).toBeNull();
      expect(result.depth).toBe(0);
    });

    it("maps null when correlation fields absent in Mongo doc", () => {
      const result = mapGatewayAuditDoc(baseDoc);

      expect(result.correlationId).toBeNull();
      expect(result.causationId).toBeNull();
      expect(result.depth).toBeNull();
    });

    it("maps depth to null when doc.depth is not a number", () => {
      const doc = { ...baseDoc, depth: "invalid" };
      const result = mapGatewayAuditDoc(doc);
      expect(result.depth).toBeNull();
    });
  });

  describe("mapGatewayAuditSqlRow", () => {
    const baseRow = {
      requestId: "req-2",
      traceId: "trace-2",
      tenantId: "t2",
      method: "GET",
      path: "/audit/events",
      statusCode: 200,
      durationMs: 10,
      clientIp: "5.6.7.8",
      userAgent: "ua",
      jwtSubject: "user-sub",
      routeType: "platform" as const,
      upstreamUrl: null,
      upstreamStatus: null,
      upstreamDuration: null,
      rateLimitApplied: false,
      rateLimitRemaining: null,
      error: null,
      correlationId: null,
      causationId: null,
      depth: null,
      created_at: new Date("2026-06-20T00:00:00Z"),
    };

    it("passes through populated correlationId/causationId/depth", () => {
      const row = {
        ...baseRow,
        correlationId: "corr-sql",
        causationId: null,
        depth: 0,
      };

      const result = mapGatewayAuditSqlRow(row);

      expect(result.correlationId).toBe("corr-sql");
      expect(result.causationId).toBeNull();
      expect(result.depth).toBe(0);
    });

    it("passes through null when no correlation in SQL row", () => {
      const result = mapGatewayAuditSqlRow(baseRow);

      expect(result.correlationId).toBeNull();
      expect(result.causationId).toBeNull();
      expect(result.depth).toBeNull();
    });
  });
});
