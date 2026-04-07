import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AdaptersProxyService } from "./adapters-proxy.service";
import {
  CreateAdapterDto,
  CreateEndpointDto,
  UpdateAdapterDto,
} from "./adapters.dto";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { ITenantScopedRequest } from "../../types/yoizen-request";

@Controller("adapters")
export class AdaptersController {
  constructor(private readonly proxy: AdaptersProxyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateAdapterDto,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: "/adapters",
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Get()
  async list(
    @Req() req: ITenantScopedRequest,
    @Query("context") context?: string,
    @Query("tag") tag?: string,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: "/adapters",
      tenantId: req[REQUEST_TENANT_KEY],
      query: { context, tag },
    });
  }

  @Get(":id")
  async get(@Req() req: ITenantScopedRequest, @Param("id") id: string) {
    return this.proxy.proxy({
      method: "GET",
      path: `/adapters/${encodeURIComponent(id)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Patch(":id")
  async update(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: UpdateAdapterDto,
  ) {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/adapters/${encodeURIComponent(id)}`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: ITenantScopedRequest, @Param("id") id: string) {
    return this.proxy.proxy({
      method: "DELETE",
      path: `/adapters/${encodeURIComponent(id)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Post(":id/endpoints")
  @HttpCode(HttpStatus.CREATED)
  async addEndpoint(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: CreateEndpointDto,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: `/adapters/${encodeURIComponent(id)}/endpoints`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Delete(":id/endpoints/:epId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeEndpoint(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Param("epId") epId: string,
  ) {
    return this.proxy.proxy({
      method: "DELETE",
      path: `/adapters/${encodeURIComponent(id)}/endpoints/${encodeURIComponent(epId)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }
}
