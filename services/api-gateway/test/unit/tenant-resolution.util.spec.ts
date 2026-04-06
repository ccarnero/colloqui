import { describe, it, expect } from "bun:test";
import { TENANT_HEADER } from "@yoizen/shared";
import { resolveTenantIdFromHttpRequest } from "../../src/utils/tenant-resolution.util";

describe("resolveTenantIdFromHttpRequest", () => {
  it("resolves host subdomain first (aligned with TenantGuard)", () => {
    expect(
      resolveTenantIdFromHttpRequest(
        { host: "dev.acme.yplatform.com" },
        { tenant: "other" },
      ),
    ).toBe("acme");
  });

  it("falls back to header then query", () => {
    expect(
      resolveTenantIdFromHttpRequest(
        { host: "example.com", [TENANT_HEADER]: "hdr" },
        { tenant: "q" },
      ),
    ).toBe("hdr");
    expect(
      resolveTenantIdFromHttpRequest({ host: "example.com" }, { tenant: "q" }),
    ).toBe("q");
  });

  it("returns null when nothing matches", () => {
    expect(
      resolveTenantIdFromHttpRequest({ host: "example.com" }, {}),
    ).toBeNull();
  });
});
