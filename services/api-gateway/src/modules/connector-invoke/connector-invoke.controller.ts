import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { ConnectorInvokeProxyService } from "./connector-invoke-proxy.service";

/**
 * T03/T05 of manual-loops/connector-invoke-api.md: gateway proxy routes for
 * the connector-invoke facade —
 * `POST /api/v1/connectors/:connectorId/endpoints/:endpointId/invoke` ->
 * connector-runtime's HTTP facade `POST /invoke/:connectorId/:endpointId`
 * (T02/T04 sync + async), and
 * `GET /api/v1/connectors/invocations/:invocationId` -> the facade's
 * `GET /invocations/:invocationId` (T05 async result polling fallback).
 * Explicit proxy module, no `@Public()` decorator — the global
 * `TenantGuard`/`AuthGuard` (`APP_GUARD`s in `AppModule`) apply exactly like
 * every other resource route, enforcing the new HTTP surface's
 * tenant-scoped authz from day one per the SPEC's constraint (the task
 * queue no longer protects connector-runtime once this route exists).
 *
 * Body (`{ args, mode? }`) and downstream status/body are forwarded
 * verbatim — no DTO validation layer here, same division of responsibility
 * as `ConnectorsController`/`TrackingController` (the facade itself
 * validates `args`/`mode` and maps invalid input to 400).
 */
@ApiTags("connectors")
@Controller("connectors")
export class ConnectorInvokeController {
  constructor(private readonly proxy: ConnectorInvokeProxyService) {}

  /**
   * T06 fix (manual-loops/connector-invoke-api.md, KNOWN GAP left by T03/T05):
   * the facade returns 200 for sync invoke and 202 + `{ invocationId }` for
   * async invoke (`mode: "async"`) — a REAL contract distinction the SDK's
   * `connectors.invoke()` depends on to discriminate a sync result from an
   * async accept. The previous `@HttpCode(HttpStatus.OK)` + `proxy()`
   * (body-only) always collapsed the facade's status to 200, silently
   * losing the async signal downstream of the gateway. `@Res({ passthrough:
   * true })` + `proxyWithStatus()` forwards the REAL downstream status (200
   * or 202) verbatim while keeping Nest's normal body
   * serialization/interceptors (passthrough mode — we still `return` the
   * body).
   */
  @Post(":connectorId/endpoints/:endpointId/invoke")
  async invoke(
    @Req() req: ITenantScopedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("connectorId") connectorId: string,
    @Param("endpointId") endpointId: string,
    @Body() body: unknown
  ): Promise<object> {
    const { status, body: responseBody } = await this.proxy.proxyWithStatus({
      method: "POST",
      path: `/invoke/${encodeURIComponent(connectorId)}/${encodeURIComponent(endpointId)}`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
    reply.status(status);
    return responseBody;
  }

  // T05: polling fallback for async invoke results. Route MUST be declared
  // BEFORE any `:connectorId/...` GET route to avoid an ambiguous prefix
  // match (none exists today, but this ordering keeps it future-proof).
  // Downstream status (200 pending/completed, 404 expired) is forwarded
  // verbatim via `downstreamJsonProxy`'s `throwProxyError`, which preserves
  // the original status code on the gateway response.
  @Get("invocations/:invocationId")
  async getInvocation(
    @Req() req: ITenantScopedRequest,
    @Param("invocationId") invocationId: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/invocations/${encodeURIComponent(invocationId)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }
}
