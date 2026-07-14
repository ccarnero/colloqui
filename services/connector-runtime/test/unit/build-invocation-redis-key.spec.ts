import { describe, expect, it } from "bun:test";
import { buildInvocationRedisKey } from "../../src/lib/invoke-consumer/build-invocation-redis-key";

describe("buildInvocationRedisKey", () => {
  it("builds a tenant-scoped key", () => {
    expect(buildInvocationRedisKey("acme", "inv-1")).toBe(
      "invocation:acme:inv-1"
    );
  });

  it("keeps two different tenants' same invocationId on different keys (tenant isolation)", () => {
    const keyA = buildInvocationRedisKey("acme", "inv-1");
    const keyB = buildInvocationRedisKey("globex", "inv-1");
    expect(keyA).not.toBe(keyB);
  });
});
