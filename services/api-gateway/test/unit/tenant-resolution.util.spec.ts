import { describe, expect, it } from "bun:test";
import { TENANT_HEADER } from "@yoizen/shared";
import { HOST_PATTERN } from "../../src/constants";
import { resolveTenantIdFromHttpRequest } from "../../src/utils/tenant-resolution.util";

describe("resolveTenantIdFromHttpRequest", () => {
  it("resolves host subdomain first (aligned with TenantGuard)", () => {
    expect(
      resolveTenantIdFromHttpRequest(
        { host: "dev.acme.yplatform.com" },
        { tenant: "other" }
      )
    ).toBe("acme");
  });

  it("prefers host over header and query when all are present", () => {
    expect(
      resolveTenantIdFromHttpRequest(
        {
          host: "dev.acme.yplatform.com",
          [TENANT_HEADER]: "hdr-tenant",
        },
        { tenant: "query-tenant" }
      )
    ).toBe("acme");
  });

  it("falls back to header then query", () => {
    expect(
      resolveTenantIdFromHttpRequest(
        { host: "example.com", [TENANT_HEADER]: "hdr" },
        { tenant: "q" }
      )
    ).toBe("hdr");
    expect(
      resolveTenantIdFromHttpRequest({ host: "example.com" }, { tenant: "q" })
    ).toBe("q");
  });

  it("prefers header over query when host does not match", () => {
    expect(
      resolveTenantIdFromHttpRequest(
        { host: "example.com", [TENANT_HEADER]: "hdr-tenant" },
        { tenant: "query-tenant" }
      )
    ).toBe("hdr-tenant");
  });

  it("returns null when nothing matches", () => {
    expect(
      resolveTenantIdFromHttpRequest({ host: "example.com" }, {})
    ).toBeNull();
  });

  it("does not match dev.local hosts against HOST_PATTERN (falls through)", () => {
    expect(HOST_PATTERN.exec("workflow-api.dev.local")).toBeNull();
    expect(HOST_PATTERN.exec("api-gateway.dev.local")).toBeNull();
  });

  it("falls through to header/query for dev.local hosts", () => {
    expect(
      resolveTenantIdFromHttpRequest(
        { host: "api-gateway.dev.local", [TENANT_HEADER]: "hdr-tenant" },
        { tenant: "query-tenant" }
      )
    ).toBe("hdr-tenant");
    expect(
      resolveTenantIdFromHttpRequest(
        { host: "api-gateway.dev.local" },
        { tenant: "query-tenant" }
      )
    ).toBe("query-tenant");
    expect(
      resolveTenantIdFromHttpRequest({ host: "api-gateway.dev.local" }, {})
    ).toBeNull();
  });
});
