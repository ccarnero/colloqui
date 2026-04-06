import "reflect-metadata";
import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { TENANT_HEADER } from "@yoizen/shared";
import { RegistryProxyService } from "../../src/modules/registry/registry-proxy.service";

describe("RegistryProxyService", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = mock((url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      expect(u).toContain("/services");
      const h = init?.headers as Record<string, string> | Headers | undefined;
      const tenant =
        h instanceof Headers
          ? h.get(TENANT_HEADER)
          : h?.[TENANT_HEADER];
      expect(tenant).toBe("t1");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ services: [] }),
      });
    }) as typeof fetch;
  });

  it("proxy forwards GET with tenant header", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [RegistryProxyService],
    }).compile();
    const svc = moduleRef.get(RegistryProxyService);

    const out = await svc.proxy({
      method: "GET",
      path: "/services",
      tenantId: "t1",
    });
    expect(out).toEqual({ services: [] });
  });
});
