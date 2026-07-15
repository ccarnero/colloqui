import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { RequirePermission } from "../../decorators/permissions.decorator";
import { Scopes } from "../../decorators/scopes.decorator";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { ProvisioningProxyService } from "./provisioning-proxy.service";

/**
 * T07 of manual-loops/declarative-provisioning.md: gateway proxy routes for
 * provisioning-service, reusing the `downstreamJsonProxyWithStatus` pattern
 * (`services/api-gateway/src/modules/connector-invoke/`) for the routes that
 * respond with typed non-200 statuses (`plan`/`apply`: 404 manifest not
 * found, 409 cycle/partial-failure). Explicit proxy module, no `@Public()`
 * decorator — the global `TenantGuard`/`AuthGuard` `APP_GUARD`s apply.
 *
 * Route scopes (SPEC.md T07):
 * - manifests validate/put/get/plan/apply: any tenant-scoped JWT
 *   (tenant-operator level) — no extra `@RequirePermission`, same bare
 *   `@Scopes`-free default every other tenant proxy route in this gateway
 *   already relies on (AuthGuard allows any authenticated tenant:<id> token
 *   whose tenant matches the request).
 * - `PUT /provisioning/secrets/:name`: tenant ADMIN scope, mirrored from
 *   `TrackingController.getPayload`'s strictest precedent — explicit
 *   `@Scopes("platform", "tenant")` + `@RequirePermission("secrets:write")`
 *   so only `tenant_admin` (wildcard `permissions: ["*"]`) or a caller
 *   explicitly granted `secrets:write` can write a secret value.
 * - `GET /provisioning/secrets`: tenant-operator level (list is
 *   names+bindings only, never values — SPEC.md write-only guarantee).
 * - The broker's internal-only `POST /internal/secrets/resolve` has NO route
 *   here on purpose — never gateway-routed (SPEC.md hard rule). See
 *   `provisioning.controller.no-internal-route.spec.ts`.
 */
@ApiTags("provisioning")
@Controller("provisioning")
export class ProvisioningController {
  constructor(private readonly proxy: ProvisioningProxyService) {}

  @Post("manifests/validate")
  @HttpCode(HttpStatus.OK)
  async validate(
    @Req() req: ITenantScopedRequest,
    @Body() body: unknown
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: "/manifests/validate",
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Put("manifests/:name")
  async putManifest(
    @Req() req: ITenantScopedRequest,
    @Param("name") name: string,
    @Body() body: unknown
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PUT",
      path: `/manifests/${encodeURIComponent(name)}`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Get("manifests/:name")
  async getManifest(
    @Req() req: ITenantScopedRequest,
    @Param("name") name: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/manifests/${encodeURIComponent(name)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Post("manifests/:name/plan")
  async plan(
    @Req() req: ITenantScopedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("name") name: string
  ): Promise<object> {
    const { status, body } = await this.proxy.proxyWithStatus({
      method: "POST",
      path: `/manifests/${encodeURIComponent(name)}/plan`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
    reply.status(status);
    return body;
  }

  @Post("manifests/:name/apply")
  async apply(
    @Req() req: ITenantScopedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("name") name: string,
    @Body() body: unknown
  ): Promise<object> {
    const { status, body: responseBody } = await this.proxy.proxyWithStatus({
      method: "POST",
      path: `/manifests/${encodeURIComponent(name)}/apply`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
    reply.status(status);
    return responseBody;
  }

  /**
   * SPEC.md: "secrets PUT requires the tenant ADMIN scope" — the only
   * admin-gated route in this module.
   */
  @Scopes("platform", "tenant")
  @RequirePermission("secrets:write")
  @Put("secrets/:name")
  async putSecret(
    @Req() req: ITenantScopedRequest,
    @Param("name") name: string,
    @Body() body: unknown
  ): Promise<object> {
    // Body carries the secret VALUE — never log it (SPEC.md constraint).
    // No `this.logger` call in this handler for that reason; the downstream
    // proxy layer (`downstreamJsonProxyWithStatus`) only logs on error, and
    // `throwProxyError` logs the downstream's response text, never the
    // request body.
    return this.proxy.proxy({
      method: "PUT",
      path: `/secrets/${encodeURIComponent(name)}`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Get("secrets")
  async listSecrets(@Req() req: ITenantScopedRequest): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/secrets",
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }
}
