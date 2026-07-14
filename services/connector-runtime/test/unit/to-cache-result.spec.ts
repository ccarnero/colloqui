import "reflect-metadata";
// Mock observability before importing modules that depend on it
import { describe, expect, it, mock } from "bun:test";

mock.module("@yoizen/observability", () => ({
  logWithEnvelope: () => {},
  injectTraceContext: () => {},
  getMeter: () => ({
    createCounter: () => ({ add() {} }),
  }),
  PinoLoggerService: class FakeLogger {
    log() {}
    warn() {}
    error() {}
  },
}));

const { toEndpointCacheResult } = await import(
  "../../src/activities/_shared/http-cache/to-cache-result"
);
const { HttpResponseCacheResult } = await import(
  "../../src/activities/_shared/metrics"
);

describe("toEndpointCacheResult", () => {
  it('maps HIT ("hit") to "hit"', () => {
    expect(toEndpointCacheResult(HttpResponseCacheResult.HIT)).toBe("hit");
  });

  it('maps MISS ("miss") to "miss"', () => {
    expect(toEndpointCacheResult(HttpResponseCacheResult.MISS)).toBe("miss");
  });

  it('maps BYPASS ("bypass") to "bypass"', () => {
    expect(toEndpointCacheResult(HttpResponseCacheResult.BYPASS)).toBe(
      "bypass"
    );
  });

  it('maps STORE ("store") to null', () => {
    expect(toEndpointCacheResult(HttpResponseCacheResult.STORE)).toBeNull();
  });

  it('maps STORE_SKIP ("store_skip") to null', () => {
    expect(
      toEndpointCacheResult(HttpResponseCacheResult.STORE_SKIP)
    ).toBeNull();
  });
});
