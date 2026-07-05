import { describe, expect, it } from "bun:test";
import {
  isK8sConflict,
  isK8sNotFound,
  k8sApiErrorMessage,
} from "../../src/utils/k8s-error";

describe("k8sApiErrorMessage", () => {
  it("returns response.body.message when present", () => {
    const err = {
      response: { body: { message: "not found" } },
    };
    expect(k8sApiErrorMessage(err)).toBe("not found");
  });

  it("falls back to Error.message", () => {
    expect(k8sApiErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies unknown values", () => {
    expect(k8sApiErrorMessage(42)).toBe("42");
  });
});

describe("isK8sNotFound", () => {
  it("returns true for legacy response.statusCode 404", () => {
    expect(isK8sNotFound({ response: { statusCode: 404 } })).toBe(true);
  });

  it("returns true for ApiException-style code 404", () => {
    expect(isK8sNotFound({ code: 404 })).toBe(true);
  });

  it("returns true for a bare statusCode 404", () => {
    expect(isK8sNotFound({ statusCode: 404 })).toBe(true);
  });

  it("returns false for other status codes", () => {
    expect(isK8sNotFound({ response: { statusCode: 500 } })).toBe(false);
    expect(isK8sNotFound({ code: 409 })).toBe(false);
  });

  it("returns false for non-object errors", () => {
    expect(isK8sNotFound("x")).toBe(false);
    expect(isK8sNotFound(null)).toBe(false);
  });
});

describe("isK8sConflict", () => {
  it("returns true for legacy response.statusCode 409", () => {
    expect(isK8sConflict({ response: { statusCode: 409 } })).toBe(true);
  });

  it("returns true for ApiException-style code 409", () => {
    expect(isK8sConflict({ code: 409 })).toBe(true);
  });

  it("returns true for a bare statusCode 409", () => {
    expect(isK8sConflict({ statusCode: 409 })).toBe(true);
  });

  it("returns false for other status codes", () => {
    expect(isK8sConflict({ response: { statusCode: 500 } })).toBe(false);
    expect(isK8sConflict({ code: 404 })).toBe(false);
  });

  it("returns false for non-object errors", () => {
    expect(isK8sConflict("x")).toBe(false);
    expect(isK8sConflict(null)).toBe(false);
  });
});
