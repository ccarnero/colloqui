import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
} from "@nestjs/common";
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

  /**
   * T03 of manual-loops/connector-trace-linking.md: proxies the ingester's
   * `GET /events?type=<t>&resource=<r>&from=<iso>&limit=<n>` — the connector
   * "Recent calls" feed (and any future entity "recent activity" panel,
   * SPEC.md "Out of scope") reading from the durable causal store instead of
   * audit-service's 60-minute window. Query params are forwarded verbatim as
   * the raw `Record<string, string>` Nest hands back from `@Query()` — same
   * pass-through shape `IJsonProxyRequest.query` already supports, no DTO
   * validation layer here (the ingester itself validates `type`/`from` and
   * clamps `limit`, same division of responsibility as `getChain`/`getRun`
   * leaving id validation to the ingester).
   */
  @Get("events")
  async getEvents(
    @Req() req: ITenantScopedRequest,
    @Query() query: Record<string, string>
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/events",
      tenantId: req[REQUEST_TENANT_KEY],
      query,
    });
  }

  /**
   * T07 of manual-loops/admin-console/console-redesign-builder-v2.md: proxies
   * the ingester's `GET /node-stats?correlationIds=a,b,c` (the option-(b)
   * per-node execution aggregate recommended by that SPEC's "T06 findings").
   * Query params are forwarded verbatim, same pass-through shape as
   * `getEvents` — the ingester itself validates `correlationIds` and bounds
   * its length.
   */
  @Get("node-stats")
  async getNodeStats(
    @Req() req: ITenantScopedRequest,
    @Query() query: Record<string, string>
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/node-stats",
      tenantId: req[REQUEST_TENANT_KEY],
      query,
    });
  }
}
