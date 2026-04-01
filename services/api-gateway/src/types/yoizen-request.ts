import type { FastifyRequest } from "fastify";
import type { JwtPayload } from "@yoizen/shared";
import type { Span } from "@yoizen/observability";

/**
 * Fastify request augmented by TenantGuard, AuthGuard, dynamic-route hooks, and metrics.
 * `user` and `tenantId` correspond to REQUEST_USER_KEY and REQUEST_TENANT_KEY in guards.
 */
export interface YoizenRequest extends FastifyRequest {
  user?: JwtPayload;
  tenantId?: string;
  __startTime?: number;
  __tenantId?: string | null;
  __rateLimitApplied?: boolean;
  __rateLimitRemaining?: number;
  __dynamicRouteSpan?: Span;
  __jwtSubject?: string;
  __upstream?: {
    url: string;
    statusCode: number;
    durationMs: number;
  };
}

/** After TenantGuard on routes that do not use @SkipTenant(). */
export type TenantScopedRequest = YoizenRequest & { tenantId: string };
