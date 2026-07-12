import { Controller, Get, NotFoundException, Param, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../decorators/permissions.decorator";
import { Scopes } from "../../decorators/scopes.decorator";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { parseRunPathSegments } from "./parse-run-path-segments";
import { TrackingProxyService } from "./tracking-proxy.service";

@ApiTags("tracking")
@Controller("tracking")
export class TrackingController {
  constructor(private readonly proxy: TrackingProxyService) {}

  @Get("chains/:correlationId")
  async getChain(
    @Req() req: ITenantScopedRequest,
    @Param("correlationId") correlationId: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/chains/${encodeURIComponent(correlationId)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  /**
   * T04 of manual-loops/payload-capture.md: tenant-admin-only payload read.
   * Guard mirrors `AuthController`'s strictest admin-guarded precedent
   * (`@Scopes("platform", "tenant")` + `@RequirePermission(...)` on the
   * tenant-roles routes, auth.controller.ts:183-184) — `AuthGuard` allows
   * `scope: "platform"` and tenant tokens carrying the required permission
   * (or the tenant_admin wildcard `permissions: ["*"]`) through, and rejects
   * every other tenant-scoped caller with a 403.
   *
   * Every successful proxy round trip is picked up by the global
   * `AuditInterceptor` (registered as `APP_INTERCEPTOR` in `AppModule`) —
   * the same audit-ingestion path every other gateway route already uses.
   * Stamping `req.__correlationId` here (mirroring
   * `WebhookIngressPublisherService`'s precedent,
   * webhook-ingress-publisher.service.ts:87-93) enriches that audit event
   * with the causal-chain `correlationId`; `eventId` is already carried by
   * the audited `path`, and `actor`/`tenantId`/`timestamp` are populated by
   * the interceptor from the verified JWT and tenant context exactly as for
   * every other route. No new event schema or publish helper is introduced.
   */
  @Scopes("platform", "tenant")
  @RequirePermission("tracking:payload:read")
  @Get("chains/:correlationId/events/:eventId/payload")
  async getPayload(
    @Req() req: ITenantScopedRequest,
    @Param("correlationId") correlationId: string,
    @Param("eventId") eventId: string
  ): Promise<object> {
    req.__correlationId = correlationId;
    return this.proxy.proxy({
      method: "GET",
      path: `/chains/${encodeURIComponent(correlationId)}/events/${encodeURIComponent(eventId)}/payload`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  /**
   * T02 of manual-loops/run-view.md: proxies the ingester's
   * `GET /runs/:workflowId/:runId` (T01). Real Temporal `workflowId`s are
   * colon-bearing (e.g. `acme:e2e-http-log:sha256:...:id`); the deployed
   * gateway's named-param route does not match those segments — verified
   * live: `/runs/foo/bar` matched, but a colon-bearing id returned Nest's
   * route-not-found 404 — so this route uses a wildcard (`runs/*`) with
   * manual parsing (`parseRunPathSegments`) instead.
   *
   * Parse contract: exactly two non-empty, decoded segments after `runs/`,
   * otherwise 404 (`Invalid run path`).
   */
  @Get("runs/*")
  async getRun(@Req() req: ITenantScopedRequest): Promise<object> {
    const segments = parseRunPathSegments(req.url);
    if (!segments) {
      throw new NotFoundException("Invalid run path");
    }
    const { workflowId, runId } = segments;
    return this.proxy.proxy({
      method: "GET",
      path: `/runs/${encodeURIComponent(workflowId)}/${encodeURIComponent(runId)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }
}
