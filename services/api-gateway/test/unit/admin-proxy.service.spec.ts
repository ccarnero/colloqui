import "reflect-metadata";
import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { TENANT_HEADER } from "@yoizen/shared";
import { AdminProxyService } from "../../src/modules/admin/admin-proxy.service";

describe("AdminProxyService", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = mock((url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      expect(u).toContain("/admin/agents");
      const h = init?.headers as Record<string, string> | Headers | undefined;
      const tenant =
        h instanceof Headers
          ? h.get(TENANT_HEADER)
          : h?.[TENANT_HEADER];
      expect(tenant).toBe("t1");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ agents: [] }),
      });
    }) as typeof fetch;
  });

  it("proxy forwards GET with tenant header", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AdminProxyService],
    }).compile();
    const svc = moduleRef.get(AdminProxyService);

    const out = await svc.proxy({
      method: "GET",
      path: "/admin/agents",
      tenantId: "t1",
    });
    expect(out).toEqual({ agents: [] });
  });
});
