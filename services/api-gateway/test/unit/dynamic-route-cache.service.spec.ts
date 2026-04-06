import { describe, it, expect } from "bun:test";
import { DynamicRouteCacheService } from "../../src/modules/dynamic-routes/dynamic-route-cache.service";

describe("DynamicRouteCacheService", () => {
  it("match returns null when tenant has no cached routes", () => {
    const svc = new DynamicRouteCacheService();
    expect(svc.match("unknown-tenant", "GET", "/api/x")).toBeNull();
  });

  it("onModuleDestroy clears interval without throwing", () => {
    const svc = new DynamicRouteCacheService();
    expect(() => svc.onModuleDestroy()).not.toThrow();
  });
});
