import { describe, expect, it } from "bun:test";
import { checkTenantHeader } from "../../src/lib/http-facade/check-tenant-header";

describe("checkTenantHeader", () => {
  it("returns ok with the tenantId when the header is present", () => {
    const result = checkTenantHeader("tenant-abc");
    expect(result).toEqual({ ok: true, tenantId: "tenant-abc" });
  });

  it("rejects a null header with 400", () => {
    const result = checkTenantHeader(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.body.error).toContain("x-yoizen-tenant");
    }
  });

  it("rejects a blank header with 400", () => {
    const result = checkTenantHeader("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });
});
