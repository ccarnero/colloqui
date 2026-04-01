import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { RegistryProxyService } from "./registry-proxy.service";
import {
  CreateRouteDto,
  RegisterServiceDto,
  StartCanaryDto,
  UpdateCanaryDto,
  UpdateServiceDto,
} from "./registry.dto";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { TenantScopedRequest } from "../../types/yoizen-request";
import { SkipTenant } from "../../decorators/skip-tenant.decorator";

@Controller("registry")
export class RegistryController {
  constructor(private readonly proxy: RegistryProxyService) {}

  @Post("services")
  @HttpCode(HttpStatus.CREATED)
  async registerService(
    @Req() req: TenantScopedRequest,
    @Body() body: RegisterServiceDto,
  ) {
    return this.proxy.proxy(
      "POST",
      "/services",
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Get("services")
  async listServices(@Req() req: TenantScopedRequest) {
    return this.proxy.proxy(
      "GET",
      "/services",
      req[REQUEST_TENANT_KEY],
    );
  }

  @Get("services/:id")
  async getService(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "GET",
      `/services/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Patch("services/:id")
  async updateService(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Body() body: UpdateServiceDto,
  ) {
    return this.proxy.proxy(
      "PATCH",
      `/services/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Delete("services/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeService(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "DELETE",
      `/services/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Get("services/:id/revisions")
  async listRevisions(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "GET",
      `/services/${encodeURIComponent(id)}/revisions`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Post("services/:id/canary")
  @HttpCode(HttpStatus.CREATED)
  async startCanary(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Body() body: StartCanaryDto,
  ) {
    return this.proxy.proxy(
      "POST",
      `/services/${encodeURIComponent(id)}/canary`,
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Patch("services/:id/canary")
  async updateCanary(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Body() body: UpdateCanaryDto,
  ) {
    return this.proxy.proxy(
      "PATCH",
      `/services/${encodeURIComponent(id)}/canary`,
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Post("services/:id/canary/promote")
  async promoteCanary(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "POST",
      `/services/${encodeURIComponent(id)}/canary/promote`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Post("services/:id/canary/rollback")
  async rollbackCanary(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "POST",
      `/services/${encodeURIComponent(id)}/canary/rollback`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Get("services/:id/canary")
  async getCanaryStatus(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "GET",
      `/services/${encodeURIComponent(id)}/canary`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Post("services/:id/routes")
  @HttpCode(HttpStatus.CREATED)
  async createRoute(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Body() body: CreateRouteDto,
  ) {
    return this.proxy.proxy(
      "POST",
      `/services/${encodeURIComponent(id)}/routes`,
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Get("services/:id/routes")
  async listServiceRoutes(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "GET",
      `/services/${encodeURIComponent(id)}/routes`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Delete("services/:id/routes/:routeId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeRoute(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Param("routeId") routeId: string,
  ) {
    return this.proxy.proxy(
      "DELETE",
      `/services/${encodeURIComponent(id)}/routes/${encodeURIComponent(routeId)}`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @SkipTenant()
  @Get("routes")
  async discoverRoutes() {
    return this.proxy.proxy("GET", "/routes", "");
  }
}
