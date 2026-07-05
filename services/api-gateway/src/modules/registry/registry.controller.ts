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
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { SkipTenant } from "../../decorators/skip-tenant.decorator";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("registry")
@Controller("registry")
export class RegistryController {
  constructor(private readonly proxy: RegistryProxyService) {}

  @Post("services")
  @HttpCode(HttpStatus.CREATED)
  async registerService(
    @Req() req: ITenantScopedRequest,
    @Body() body: RegisterServiceDto,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: "/services",
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Get("services")
  async listServices(@Req() req: ITenantScopedRequest) {
    return this.proxy.proxy({
      method: "GET",
      path: "/services",
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Get("services/:id")
  async getService(@Req() req: ITenantScopedRequest, @Param("id") id: string) {
    return this.proxy.proxy({
      method: "GET",
      path: `/services/${encodeURIComponent(id)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Patch("services/:id")
  async updateService(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: UpdateServiceDto,
  ) {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/services/${encodeURIComponent(id)}`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Delete("services/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeService(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "DELETE",
      path: `/services/${encodeURIComponent(id)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Get("services/:id/revisions")
  async listRevisions(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: `/services/${encodeURIComponent(id)}/revisions`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Post("services/:id/canary")
  @HttpCode(HttpStatus.CREATED)
  async startCanary(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: StartCanaryDto,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: `/services/${encodeURIComponent(id)}/canary`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Patch("services/:id/canary")
  async updateCanary(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: UpdateCanaryDto,
  ) {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/services/${encodeURIComponent(id)}/canary`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Post("services/:id/canary/promote")
  async promoteCanary(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: `/services/${encodeURIComponent(id)}/canary/promote`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Post("services/:id/canary/rollback")
  async rollbackCanary(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: `/services/${encodeURIComponent(id)}/canary/rollback`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Get("services/:id/canary")
  async getCanaryStatus(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: `/services/${encodeURIComponent(id)}/canary`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Post("services/:id/routes")
  @HttpCode(HttpStatus.CREATED)
  async createRoute(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: CreateRouteDto,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: `/services/${encodeURIComponent(id)}/routes`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Get("services/:id/routes")
  async listServiceRoutes(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: `/services/${encodeURIComponent(id)}/routes`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Delete("services/:id/routes/:routeId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeRoute(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Param("routeId") routeId: string,
  ) {
    return this.proxy.proxy({
      method: "DELETE",
      path: `/services/${encodeURIComponent(id)}/routes/${encodeURIComponent(routeId)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @SkipTenant()
  @Get("routes")
  async discoverRoutes() {
    return this.proxy.proxy({
      method: "GET",
      path: "/routes",
      tenantId: "",
    });
  }
}
