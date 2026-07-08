import { describe, expect, it } from "bun:test";
import {
  isDeprecatedUnversionedApiPath,
  toSuccessorVersionPath,
} from "../../src/utils/api-versioning.util";

describe("isDeprecatedUnversionedApiPath", () => {
  it("returns true for unversioned /api/... paths", () => {
    expect(isDeprecatedUnversionedApiPath("/api/foo")).toBe(true);
    expect(isDeprecatedUnversionedApiPath("/api/tenants")).toBe(true);
  });

  it("returns false for versioned /api/v1/... paths", () => {
    expect(isDeprecatedUnversionedApiPath("/api/v1/foo")).toBe(false);
  });

  it("returns false for exempt prefixes (Swagger docs)", () => {
    expect(isDeprecatedUnversionedApiPath("/api/docs")).toBe(false);
    expect(isDeprecatedUnversionedApiPath("/api/docs/json")).toBe(false);
  });

  it("returns false for paths outside the /api/ prefix", () => {
    expect(isDeprecatedUnversionedApiPath("/health")).toBe(false);
    expect(isDeprecatedUnversionedApiPath("/events")).toBe(false);
  });
});

describe("toSuccessorVersionPath", () => {
  it("inserts v1/ right after the /api/ prefix", () => {
    expect(toSuccessorVersionPath("/api/foo")).toBe("/api/v1/foo");
    expect(toSuccessorVersionPath("/api/tenants/123")).toBe(
      "/api/v1/tenants/123"
    );
  });
});
