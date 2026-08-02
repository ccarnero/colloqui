import { describe, expect, it } from "bun:test";
import { TENANTS_PLATFORM_SCHEMA_SQL } from "../../src/providers/platform-postgres.provider";

describe("TENANTS_PLATFORM_SCHEMA_SQL", () => {
  it("defines tenants table and name index", () => {
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain(
      "CREATE TABLE IF NOT EXISTS tenants"
    );
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain(
      "idx_tenants_name ON tenants"
    );
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain(
      "idx_tenants_provisioning_incomplete"
    );
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain("tier");
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain("tenants_tier_check");
    // tenant-messaging-tiers T01: column + constraint interpolated from the
    // shared constants, so the DDL cannot drift from TENANT_TIERS.
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain(
      "ADD COLUMN IF NOT EXISTS messaging_tier"
    );
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain(
      "tenants_messaging_tier_check"
    );
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain(
      "CHECK (messaging_tier IN ('free', 'pro', 'enterprise'))"
    );
    expect(TENANTS_PLATFORM_SCHEMA_SQL).toContain(
      "messaging_tier\n  TEXT NOT NULL DEFAULT 'free'"
    );
  });
});
