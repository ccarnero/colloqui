import { describe, expect, it } from "bun:test";
import { mapEndpointCallErrorToApplicationFailure } from "../../src/activities/map-endpoint-call-error-to-application-failure";

// Direct unit tests for the wrapper's error-mapping function — no module
// mocking required (avoids cross-file `mock.module` collisions with other
// specs that import `src/lib/endpoint-call-core`; see
// `manual-loops/connector-invoke-api.md` T01).
describe("mapEndpointCallErrorToApplicationFailure", () => {
  it("maps breaker_open to a retryable CIRCUIT_OPEN ApplicationFailure with the cooldown as nextRetryDelay", () => {
    let caught: unknown = null;
    try {
      mapEndpointCallErrorToApplicationFailure({
        kind: "breaker_open",
        key: "cb:endpoint:t1:adp-1",
        status: "open",
        reason: "cooldown",
        cooldownMs: 30_000,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).not.toBeNull();
    expect((caught as { type?: string }).type).toBe("CIRCUIT_OPEN");
    expect((caught as { nonRetryable?: boolean }).nonRetryable).toBe(false);
    expect((caught as { nextRetryDelay?: unknown }).nextRetryDelay).toBe(
      30_000
    );
  });

  it("maps invalid_args (INVALID_ENDPOINT_CALL_URL) to a non-retryable ApplicationFailure carrying the original code", () => {
    let caught: unknown = null;
    try {
      mapEndpointCallErrorToApplicationFailure({
        kind: "invalid_args",
        code: "INVALID_ENDPOINT_CALL_URL",
        message: "bad url",
        details: { url: "/relative" },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).not.toBeNull();
    expect((caught as { type?: string }).type).toBe(
      "INVALID_ENDPOINT_CALL_URL"
    );
    expect((caught as { nonRetryable?: boolean }).nonRetryable).toBe(true);
    expect((caught as { message?: string }).message).toBe("bad url");
  });

  it("maps invalid_args (INVALID_ENDPOINT_CALL_ARGS) to a non-retryable ApplicationFailure carrying the original code", () => {
    let caught: unknown = null;
    try {
      mapEndpointCallErrorToApplicationFailure({
        kind: "invalid_args",
        code: "INVALID_ENDPOINT_CALL_ARGS",
        message: "missing url",
        details: { adapterId: "adp-1" },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).not.toBeNull();
    expect((caught as { type?: string }).type).toBe(
      "INVALID_ENDPOINT_CALL_ARGS"
    );
    expect((caught as { nonRetryable?: boolean }).nonRetryable).toBe(true);
  });

  it("rethrows the original cause unchanged for http_error (no ApplicationFailure repackaging)", () => {
    const originalError = new Error("HTTP 500");
    let caught: unknown = null;
    try {
      mapEndpointCallErrorToApplicationFailure({
        kind: "http_error",
        message: "HTTP 500",
        cause: originalError,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(originalError);
  });

  it("rethrows the original cause unchanged for timeout", () => {
    const originalError = new DOMException(
      "The operation was aborted.",
      "TimeoutError"
    );
    let caught: unknown = null;
    try {
      mapEndpointCallErrorToApplicationFailure({
        kind: "timeout",
        message: originalError.message,
        cause: originalError,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(originalError);
  });
});
