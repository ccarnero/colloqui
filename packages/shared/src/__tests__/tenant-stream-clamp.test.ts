import { describe, expect, test } from "bun:test";
import {
  clampTenantStreamLimits,
  MESSAGING_MAX_BYTES_CEILING_ENV,
  MESSAGING_MAX_REPLICAS_CEILING_ENV,
  readMessagingCeilingsFromEnv,
  TENANT_TIER_LIMITS,
} from "../tenant-stream.constants";

/**
 * tenant-messaging-tiers T02 — environment clamp (SPEC decision 3): the
 * environment never changes a tenant's TIER, it caps the EFFECTIVE limits.
 */
describe("clampTenantStreamLimits", () => {
  test("no ceilings — returns the limits unchanged (new object, not mutated)", () => {
    const input = TENANT_TIER_LIMITS.pro;
    const out = clampTenantStreamLimits(input, {});
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  test("clamps max_bytes and num_replicas; never touches age or msg size", () => {
    const out = clampTenantStreamLimits(TENANT_TIER_LIMITS.enterprise, {
      maxBytesCeiling: 536_870_912,
      maxReplicasCeiling: 1,
    });
    expect(out.max_bytes).toBe(536_870_912);
    expect(out.num_replicas).toBe(1);
    expect(out.max_age).toBe(TENANT_TIER_LIMITS.enterprise.max_age);
    expect(out.max_msg_size).toBe(TENANT_TIER_LIMITS.enterprise.max_msg_size);
    expect(out.object_store_max_bytes).toBe(
      TENANT_TIER_LIMITS.enterprise.object_store_max_bytes
    );
  });

  test("a ceiling above the tier's value is a no-op (min, not override)", () => {
    const out = clampTenantStreamLimits(TENANT_TIER_LIMITS.free, {
      maxBytesCeiling: Number.MAX_SAFE_INTEGER,
      maxReplicasCeiling: 5,
    });
    expect(out).toEqual(TENANT_TIER_LIMITS.free);
  });
});

describe("readMessagingCeilingsFromEnv", () => {
  test("absent or empty vars mean no clamp", () => {
    expect(readMessagingCeilingsFromEnv({})).toEqual({
      maxBytesCeiling: undefined,
      maxReplicasCeiling: undefined,
    });
    expect(
      readMessagingCeilingsFromEnv({
        [MESSAGING_MAX_BYTES_CEILING_ENV]: "",
      }).maxBytesCeiling
    ).toBeUndefined();
  });

  test("parses positive integers", () => {
    const out = readMessagingCeilingsFromEnv({
      [MESSAGING_MAX_BYTES_CEILING_ENV]: "536870912",
      [MESSAGING_MAX_REPLICAS_CEILING_ENV]: "1",
    });
    expect(out.maxBytesCeiling).toBe(536_870_912);
    expect(out.maxReplicasCeiling).toBe(1);
  });

  test("a set-but-invalid ceiling throws instead of silently deploying uncapped", () => {
    for (const bad of ["abc", "-1", "0", "1.5"]) {
      expect(() =>
        readMessagingCeilingsFromEnv({
          [MESSAGING_MAX_BYTES_CEILING_ENV]: bad,
        })
      ).toThrow("MESSAGING_MAX_BYTES_CEILING must be a positive integer");
    }
  });
});
