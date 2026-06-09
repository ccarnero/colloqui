import "../../setup-env";
import { describe, it, expect, beforeEach, vi } from "bun:test";

const load = async () => {
  const { SKBRateLimitGuard } = await import(
    "../../src/modules/structured-kb/skb-rate-limit.guard"
  );
  return { SKBRateLimitGuard };
};

function mockExecutionContext(tenantId: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ tenantId }),
    }),
    getClass: () => ({}),
    getHandler: () => ({}),
  } as any;
}

describe("SKBRateLimitGuard", () => {
  let guard: any;

  beforeEach(async () => {
    const { SKBRateLimitGuard } = await load();
    guard = new SKBRateLimitGuard();
  });

  it("should allow requests under the limit", () => {
    const ctx = mockExecutionContext("tenant-1");

    for (let i = 0; i < 29; i++) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it("should block requests over the limit (429)", () => {
    const ctx = mockExecutionContext("tenant-1");

    for (let i = 0; i < 30; i++) {
      guard.canActivate(ctx);
    }

    expect(() => guard.canActivate(ctx)).toThrow(/rate limit/i);
  });

  it("should reset after the window expires", () => {
    const ctx = mockExecutionContext("tenant-1");

    for (let i = 0; i < 30; i++) {
      guard.canActivate(ctx);
    }

    vi.useFakeTimers();
    vi.advanceTimersByTime(60_001);

    expect(guard.canActivate(ctx)).toBe(true);

    vi.useRealTimers();
  });

  it("should track different tenants independently", () => {
    const ctxA = mockExecutionContext("tenant-a");
    const ctxB = mockExecutionContext("tenant-b");

    for (let i = 0; i < 30; i++) {
      guard.canActivate(ctxA);
    }

    expect(() => guard.canActivate(ctxA)).toThrow(/rate limit/i);
    expect(guard.canActivate(ctxB)).toBe(true);
  });

  it("should use 'anonymous' key when tenantId is missing", () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
      getClass: () => ({}),
      getHandler: () => ({}),
    } as any;

    expect(guard.canActivate(ctx)).toBe(true);
  });
});
