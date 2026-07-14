import { describe, expect, it } from "bun:test";
import type { EndpointCallError } from "../../src/lib/endpoint-call-core";
import { mapEndpointCallErrorToHttpResponse } from "../../src/lib/http-facade/map-endpoint-call-error-to-http-response";

describe("mapEndpointCallErrorToHttpResponse", () => {
  it("maps breaker_open to 503 with retryAfterMs", () => {
    const error: EndpointCallError = {
      kind: "breaker_open",
      key: "t1:endpoint:adp-1",
      status: "OPEN",
      reason: "too many failures",
      cooldownMs: 5000,
    };
    const result = mapEndpointCallErrorToHttpResponse(error);
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("circuit_open");
    expect(result.body.retryAfterMs).toBe(5000);
  });

  it("maps invalid_args to 400", () => {
    const error: EndpointCallError = {
      kind: "invalid_args",
      code: "INVALID_ENDPOINT_CALL_ARGS",
      message: "bad args",
      details: { adapterId: "adp-1" },
    };
    const result = mapEndpointCallErrorToHttpResponse(error);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("INVALID_ENDPOINT_CALL_ARGS");
    expect(result.body.details).toEqual({ adapterId: "adp-1" });
  });

  it("maps http_error to 502", () => {
    const error: EndpointCallError = {
      kind: "http_error",
      message: "connection refused",
      cause: new Error("connection refused"),
    };
    const result = mapEndpointCallErrorToHttpResponse(error);
    expect(result.status).toBe(502);
    expect(result.body.error).toBe("upstream_http_error");
  });

  it("maps timeout to 504", () => {
    const error: EndpointCallError = {
      kind: "timeout",
      message: "timed out",
      cause: new Error("timed out"),
    };
    const result = mapEndpointCallErrorToHttpResponse(error);
    expect(result.status).toBe(504);
    expect(result.body.error).toBe("upstream_timeout");
  });
});
