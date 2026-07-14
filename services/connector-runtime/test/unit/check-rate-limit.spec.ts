import { describe, expect, it } from "bun:test";
import {
  checkRateLimit,
  createRateLimitState,
} from "../../src/lib/http-facade/check-rate-limit";

describe("checkRateLimit", () => {
  const config = { limit: 2, windowMs: 1000 };

  it("allows requests under the limit", () => {
    const state = createRateLimitState();
    const r1 = checkRateLimit(state, "t1", config, 0);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(1);

    const r2 = checkRateLimit(state, "t1", config, 100);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(0);
  });

  it("rejects requests once the limit is hit within the window", () => {
    const state = createRateLimitState();
    checkRateLimit(state, "t1", config, 0);
    checkRateLimit(state, "t1", config, 100);

    const r3 = checkRateLimit(state, "t1", config, 200);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.limit).toBe(2);
  });

  it("allows again once the window slides past the oldest hit", () => {
    const state = createRateLimitState();
    checkRateLimit(state, "t1", config, 0);
    checkRateLimit(state, "t1", config, 100);
    expect(checkRateLimit(state, "t1", config, 200).allowed).toBe(false);

    // Oldest hit (t=0) is now outside the 1000ms window.
    const r = checkRateLimit(state, "t1", config, 1001);
    expect(r.allowed).toBe(true);
  });

  it("tracks tenants independently", () => {
    const state = createRateLimitState();
    checkRateLimit(state, "t1", config, 0);
    checkRateLimit(state, "t1", config, 0);
    expect(checkRateLimit(state, "t1", config, 0).allowed).toBe(false);

    // A different tenant has its own bucket.
    const r = checkRateLimit(state, "t2", config, 0);
    expect(r.allowed).toBe(true);
  });
});
