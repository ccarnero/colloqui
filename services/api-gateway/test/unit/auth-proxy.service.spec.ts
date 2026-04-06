import "reflect-metadata";
import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { TENANT_HEADER } from "@yoizen/shared";
import { AuthProxyService } from "../../src/modules/auth/auth-proxy.service";

describe("AuthProxyService", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = mock((url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      expect(u).toContain("/auth/clients");
      const h = init?.headers as Record<string, string> | Headers | undefined;
      const tenant =
        h instanceof Headers
          ? h.get(TENANT_HEADER)
          : h?.[TENANT_HEADER];
      expect(tenant).toBe("t1");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [] }),
      });
    }) as typeof fetch;
  });

  it("proxy forwards GET with optional tenant header", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AuthProxyService],
    }).compile();
    const svc = moduleRef.get(AuthProxyService);

    const out = await svc.proxy({
      method: "GET",
      path: "/auth/clients",
      tenantId: "t1",
    });
    expect(out).toEqual({ items: [] });
  });
});
