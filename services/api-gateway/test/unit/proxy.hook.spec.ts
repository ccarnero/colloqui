import { describe, it, expect, mock } from "bun:test";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  resolveTenantFromRequest,
  PLATFORM_PREFIXES,
  isPlatformRoutePath,
  verifyBearerForPrivateRoute,
} from "../../src/hooks/proxy.hook";
import type { IYoizenRequest } from "../../src/types/yoizen-request";
import { TENANT_HEADER } from "@yoizen/shared";

describe("proxy.hook helpers", () => {
  it("resolveTenantFromRequest returns header tenant", () => {
    const req = {
      headers: { [TENANT_HEADER]: "acme-corp" },
      query: {},
    } as Parameters<typeof resolveTenantFromRequest>[0];
    expect(resolveTenantFromRequest(req)).toBe("acme-corp");
  });

  it("resolveTenantFromRequest returns null when missing", () => {
    const req = {
      headers: { host: "example.com" },
      query: {},
    } as Parameters<typeof resolveTenantFromRequest>[0];
    expect(resolveTenantFromRequest(req)).toBeNull();
  });

  it("resolveTenantFromRequest returns query ?tenant= when host has no subdomain", () => {
    const req = {
      headers: { host: "example.com" },
      query: { tenant: "q-tenant" },
    } as Parameters<typeof resolveTenantFromRequest>[0];
    expect(resolveTenantFromRequest(req)).toBe("q-tenant");
  });

  it("resolveTenantFromRequest prefers host subdomain over query", () => {
    const req = {
      headers: { host: "dev.acme.yplatform.com" },
      query: { tenant: "other" },
    } as Parameters<typeof resolveTenantFromRequest>[0];
    expect(resolveTenantFromRequest(req)).toBe("acme");
  });

  it("PLATFORM_PREFIXES covers core API routes", () => {
    expect(PLATFORM_PREFIXES.includes("/health")).toBe(true);
    expect(PLATFORM_PREFIXES.includes("/api/events")).toBe(true);
  });

  it("isPlatformRoutePath returns true for gateway-owned prefixes", () => {
    expect(isPlatformRoutePath("/health")).toBe(true);
    expect(isPlatformRoutePath("/api/events")).toBe(true);
    expect(isPlatformRoutePath("/tenant-app/foo")).toBe(false);
  });

  it("verifyBearerForPrivateRoute skips JWT when route is public", async () => {
    const jwtVerify = mock(() =>
      Promise.resolve({ sub: "u1", scope: "tenant:t1" }),
    );
    const out = await verifyBearerForPrivateRoute({
      req: { headers: {} } as FastifyRequest,
      reply: { status: mock(), send: mock() } as unknown as FastifyReply,
      yReq: {} as IYoizenRequest,
      tenantId: "t1",
      matched: {
        isPublic: true,
        knativeName: "svc",
        namespace: "ns",
        port: 80,
        upstreamPath: "/",
      },
      jwtService: { verify: jwtVerify },
      tracer: {
        startSpan: mock(() => ({
          end: mock(),
          setStatus: mock(),
        })),
      },
      span: { end: mock(), setStatus: mock() },
    });
    expect(out).toBe(true);
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it("verifyBearerForPrivateRoute returns 401 when Authorization is missing", async () => {
    const send = mock();
    const reply = { status: mock(() => reply), send } as unknown as FastifyReply;
    const out = await verifyBearerForPrivateRoute({
      req: { headers: {} } as FastifyRequest,
      reply,
      yReq: {} as IYoizenRequest,
      tenantId: "t1",
      matched: {
        isPublic: false,
        knativeName: "svc",
        namespace: "ns",
        port: 80,
        upstreamPath: "/",
      },
      jwtService: { verify: mock() },
      tracer: {
        startSpan: mock(() => ({
          end: mock(),
          setStatus: mock(),
        })),
      },
      span: { end: mock(), setStatus: mock() },
    });
    expect(out).toBe(false);
    expect(reply.status).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalled();
  });
});
