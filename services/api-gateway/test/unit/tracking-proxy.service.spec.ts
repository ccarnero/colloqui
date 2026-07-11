import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { TENANT_HEADER } from "@yoizen/shared";
import { TrackingProxyService } from "../../src/modules/tracking/tracking-proxy.service";

describe("TrackingProxyService", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = mock((url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      expect(u).toContain("/chains/corr-1");
      const h = init?.headers as Record<string, string> | Headers | undefined;
      const tenant =
        h instanceof Headers ? h.get(TENANT_HEADER) : h?.[TENANT_HEADER];
      expect(tenant).toBe("t1");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ correlationId: "corr-1", events: [] }),
      });
    }) as typeof fetch;
  });

  it("proxy forwards GET with tenant header", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [TrackingProxyService],
    }).compile();
    const svc = moduleRef.get(TrackingProxyService);

    const out = await svc.proxy({
      method: "GET",
      path: "/chains/corr-1",
      tenantId: "t1",
    });
    expect(out).toEqual({ correlationId: "corr-1", events: [] });
  });
});
