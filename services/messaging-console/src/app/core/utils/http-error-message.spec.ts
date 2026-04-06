import { describe, it, expect } from "vitest";
import { getHttpErrorMessage } from "./http-error-message";

describe("getHttpErrorMessage", () => {
  it("prefers nested error.message", () => {
    expect(
      getHttpErrorMessage({ error: { message: "nested" } }, "fallback"),
    ).toBe("nested");
  });

  it("uses top-level message when nested missing", () => {
    expect(getHttpErrorMessage({ message: "top" }, "fallback")).toBe("top");
  });

  it("returns fallback for empty shapes", () => {
    expect(getHttpErrorMessage({}, "fallback")).toBe("fallback");
    expect(getHttpErrorMessage(null, "fallback")).toBe("fallback");
  });
});
