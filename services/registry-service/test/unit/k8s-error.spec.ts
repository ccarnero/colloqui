import { describe, it, expect } from "bun:test";
import {
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
  it("returns true when response statusCode is 404", () => {
    expect(isK8sNotFound({ response: { statusCode: 404 } })).toBe(true);
  });

  it("returns false for other status codes", () => {
    expect(isK8sNotFound({ response: { statusCode: 500 } })).toBe(false);
  });

  it("returns false for non-object errors", () => {
    expect(isK8sNotFound("x")).toBe(false);
  });
});
