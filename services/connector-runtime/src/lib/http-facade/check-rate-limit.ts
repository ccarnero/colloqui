// Per-tenant sliding-window rate limiter for the HTTP invoke facade
// (`manual-loops/connector-invoke-api.md` T02). Uses the same
// `RateLimitTenantConfig`/`RateLimitResult` shapes as
// `@yoizen/shared/rate-limit.interfaces.ts` (already the platform's rate
// limit contract, e.g. `api-gateway`'s `rate-limit.service.ts`) so this
// stays consistent with the rest of the platform without redefining a
// parallel shape.
//
// Deliberately in-memory (per-pod), not Redis-backed like the breaker: the
// facade rate limit gates per-pod RPS (the deployment note in the service
// README — "facade scales on RPS"), it does not need cross-pod accuracy.
// State lives in the caller (`src/http-main.ts`, the only I/O edge) and is
// threaded in/out so this function stays pure and unit-testable.

import type { RateLimitResult, RateLimitTenantConfig } from "@yoizen/shared";

export interface RateLimitState {
  readonly hits: Map<string, number[]>;
}

export function createRateLimitState(): RateLimitState {
  return { hits: new Map() };
}

/**
 * Sliding-window check: counts requests within `[now - windowMs, now]` for
 * `tenantId`. Mutates `state.hits` in place (records the request when
 * allowed) so the caller doesn't have to thread a returned state back in.
 */
export function checkRateLimit(
  state: RateLimitState,
  tenantId: string,
  config: Pick<RateLimitTenantConfig, "limit" | "windowMs">,
  now: number = Date.now()
): RateLimitResult {
  const windowStart = now - config.windowMs;
  const existing = state.hits.get(tenantId) ?? [];
  const withinWindow = existing.filter((ts) => ts > windowStart);

  if (withinWindow.length >= config.limit) {
    state.hits.set(tenantId, withinWindow);
    const oldest = withinWindow[0] ?? now;
    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      resetSeconds: Math.max(
        0,
        Math.ceil((oldest + config.windowMs - now) / 1000)
      ),
    };
  }

  withinWindow.push(now);
  state.hits.set(tenantId, withinWindow);
  return {
    allowed: true,
    limit: config.limit,
    remaining: config.limit - withinWindow.length,
    resetSeconds: Math.ceil(config.windowMs / 1000),
  };
}
