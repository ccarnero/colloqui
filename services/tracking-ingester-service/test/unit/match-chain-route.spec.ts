import { describe, expect, it } from "bun:test";
import { matchChainRoute } from "../../src/lib/match-chain-route.js";

describe("matchChainRoute", () => {
  it("matches /chains/:correlationId", () => {
    expect(matchChainRoute("/chains/corr-1")).toEqual({
      correlationId: "corr-1",
    });
  });

  it("URL-decodes the correlation id", () => {
    expect(matchChainRoute("/chains/corr%201")).toEqual({
      correlationId: "corr 1",
    });
  });

  it("returns null for /chains with no id", () => {
    expect(matchChainRoute("/chains")).toBeNull();
    expect(matchChainRoute("/chains/")).toBeNull();
  });

  it("returns null for nested/unrelated paths", () => {
    expect(matchChainRoute("/chains/corr-1/spans")).toBeNull();
    expect(matchChainRoute("/health")).toBeNull();
    expect(matchChainRoute("/")).toBeNull();
  });
});
