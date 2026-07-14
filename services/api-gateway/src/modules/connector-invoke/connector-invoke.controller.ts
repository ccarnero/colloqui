import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
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

  // Facade returns 200 for sync invoke (T02); Nest's default POST status is
  // 201, so this must be explicit to keep the gateway's status passthrough
  // exact.
  @Post(":connectorId/endpoints/:endpointId/invoke")
  @HttpCode(HttpStatus.OK)
  async invoke(
    @Req() req: ITenantScopedRequest,
    @Param("connectorId") connectorId: string,
    @Param("endpointId") endpointId: string,
    @Body() body: unknown
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/invoke/${encodeURIComponent(connectorId)}/${encodeURIComponent(endpointId)}`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
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
