import { describe, it, expect } from "bun:test";
import { TENANTS_PLATFORM_MONGO_SCHEMA } from "../../src/providers/platform-mongo.provider";

describe("TENANTS_PLATFORM_MONGO_SCHEMA", () => {
  it("defines tenants collection and indexes", () => {
    expect(TENANTS_PLATFORM_MONGO_SCHEMA).toHaveLength(1);
    const tenants = TENANTS_PLATFORM_MONGO_SCHEMA[0]!;
    expect(tenants.collection).toBe("tenants");
    const indexNames = tenants.indexes.map((index) => index.options?.name);
    expect(indexNames).toContain("uniq_tenants_name");
    expect(indexNames).toContain("idx_tenants_tier");
    expect(indexNames).toContain("idx_tenants_provisioning_incomplete");
  });
});
