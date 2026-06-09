import "../setup-env";
import { describe, it, expect } from "bun:test";
import { TenantGuard } from "../../src/guards/tenant.guard";

describe("TenantGuard", () => {
  it("re-exports guard from @yoizen/database", () => {
    expect(TenantGuard).toBeDefined();
    expect(typeof TenantGuard).toBe("function");
  });
});
