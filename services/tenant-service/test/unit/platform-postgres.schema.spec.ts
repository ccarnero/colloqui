import { describe, it, expect } from "bun:test";
import { TENANTS_PLATFORM_SCHEMA_SQL } from "../../src/providers/platform-postgres.provider";

describe("TENANTS_PLATFORM_SCHEMA_SQL", () => {
  it("defines tenants table and name index", () => {
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain(
      "CREATE TABLE IF NOT EXISTS tenants",
    );
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain(
      "idx_tenants_name ON tenants",
    );
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain(
      "idx_tenants_provisioning_incomplete",
    );
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain("tier");
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain("tenants_tier_check");
  });
});
