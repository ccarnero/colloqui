import {
  Body,
  Controller,
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
 * T03 of manual-loops/connector-invoke-api.md: gateway proxy route for the
 * sync connector-invoke flavor —
 * `POST /api/v1/connectors/:connectorId/endpoints/:endpointId/invoke` ->
 * connector-runtime's HTTP facade `POST /invoke/:connectorId/:endpointId`
 * (T02). Explicit proxy module, no `@Public()` decorator — the global
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
}
