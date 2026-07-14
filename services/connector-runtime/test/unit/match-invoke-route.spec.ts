import { describe, expect, it } from "bun:test";
import { matchInvokeRoute } from "../../src/lib/http-facade/match-invoke-route";

describe("matchInvokeRoute", () => {
  it("matches /invoke/:connectorId/:endpointId", () => {
    const result = matchInvokeRoute("/invoke/adp-1/ep-1");
    expect(result).toEqual({ connectorId: "adp-1", endpointId: "ep-1" });
  });

  it("decodes URL-encoded segments", () => {
    const result = matchInvokeRoute("/invoke/adp%20one/ep%2Ftwo");
    expect(result).toEqual({ connectorId: "adp one", endpointId: "ep/two" });
  });

  it("tolerates a trailing slash", () => {
    const result = matchInvokeRoute("/invoke/adp-1/ep-1/");
    expect(result).toEqual({ connectorId: "adp-1", endpointId: "ep-1" });
  });

  it("returns null for a missing endpointId segment", () => {
    expect(matchInvokeRoute("/invoke/adp-1")).toBeNull();
  });

  it("returns null for unrelated paths", () => {
    expect(matchInvokeRoute("/health")).toBeNull();
    expect(matchInvokeRoute("/invoke2/adp-1/ep-1")).toBeNull();
  });

  it("returns null for extra path segments", () => {
    expect(matchInvokeRoute("/invoke/adp-1/ep-1/extra")).toBeNull();
  });
});
