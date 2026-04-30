import { describe, test, expect } from "bun:test";
import {
  extractTenantId,
  validateTenantId,
  isPlatformTenantRowIdParam,
} from "../tenant.utils";

describe("extractTenantId", () => {
  test("extracts tenant from x-yoizen-tenant header", () => {
    const headers = { "x-yoizen-tenant": "acme" };
    expect(extractTenantId(headers)).toBe("acme");
  });

  test("extracts tenant with case-insensitive header lookup", () => {
    const headers = { "X-Yoizen-Tenant": "acme" };
    expect(extractTenantId(headers)).toBe("acme");
  });

  test("returns null when header is missing", () => {
    const headers = { "content-type": "application/json" };
    expect(extractTenantId(headers)).toBeNull();
  });

  test("returns null for empty headers", () => {
    expect(extractTenantId({})).toBeNull();
  });

  test("returns tenant value when multiple headers present", () => {
    const headers = {
      "content-type": "application/json",
      "x-yoizen-tenant": "my-tenant",
      authorization: "Bearer token",
    };
    expect(extractTenantId(headers)).toBe("my-tenant");
  });
});

describe("validateTenantId", () => {
  test("accepts alphanumeric tenant ID", () => {
    expect(validateTenantId("acme")).toBe(true);
  });

  test("accepts tenant ID with hyphens", () => {
    expect(validateTenantId("my-tenant")).toBe(true);
  });

  test("accepts tenant ID with numbers", () => {
    expect(validateTenantId("tenant42")).toBe(true);
  });

  test("accepts minimum length (3 chars)", () => {
    expect(validateTenantId("abc")).toBe(true);
  });

  test("accepts maximum length (32 chars)", () => {
    expect(validateTenantId("a".repeat(32))).toBe(true);
  });

  test("rejects too short (2 chars)", () => {
    expect(validateTenantId("ab")).toBe(false);
  });

  test("rejects too long (33 chars)", () => {
    expect(validateTenantId("a".repeat(33))).toBe(false);
  });

  test("rejects underscores", () => {
    expect(validateTenantId("my_tenant")).toBe(false);
  });

  test("rejects spaces", () => {
    expect(validateTenantId("my tenant")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(validateTenantId("")).toBe(false);
  });

  test("rejects special characters", () => {
    expect(validateTenantId("tenant!")).toBe(false);
  });
});

describe("isPlatformTenantRowIdParam", () => {
  test("accepts 36-char lowercase UUID v4", () => {
    expect(
      isPlatformTenantRowIdParam("550e8400-e29b-41d4-a716-446655440000"),
    ).toBe(true);
  });

  test("rejects DNS tenant name (shorter than UUID)", () => {
    expect(isPlatformTenantRowIdParam("acme")).toBe(false);
  });

  test("rejects 36 non-hex chars", () => {
    expect(
      isPlatformTenantRowIdParam("gggggggg-gggg-gggg-gggg-gggggggggggg"),
    ).toBe(false);
  });
});
