import { describe, expect, it } from "bun:test";
import { matchGetInvocationRoute } from "../../src/lib/http-facade/match-get-invocation-route";

describe("matchGetInvocationRoute", () => {
  it("matches /invocations/:invocationId", () => {
    expect(matchGetInvocationRoute("/invocations/inv-1")).toBe("inv-1");
  });

  it("decodes URI-encoded segments", () => {
    expect(matchGetInvocationRoute("/invocations/inv%2F1")).toBe("inv/1");
  });

  it("returns null for a non-matching path", () => {
    expect(matchGetInvocationRoute("/invoke/adp-1/ep-1")).toBeNull();
    expect(matchGetInvocationRoute("/invocations/")).toBeNull();
    expect(matchGetInvocationRoute("/invocations")).toBeNull();
  });
});
