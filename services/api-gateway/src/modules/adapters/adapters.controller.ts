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
import type { TenantScopedRequest } from "../../types/yoizen-request";

@Controller("adapters")
export class AdaptersController {
  constructor(private readonly proxy: AdaptersProxyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: TenantScopedRequest,
    @Body() body: CreateAdapterDto,
  ) {
    return this.proxy.proxy(
      "POST",
      "/adapters",
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Get()
  async list(
    @Req() req: TenantScopedRequest,
    @Query("context") context?: string,
  ) {
    return this.proxy.proxy("GET", "/adapters", req[REQUEST_TENANT_KEY], {
      context,
    });
  }

  @Get(":id")
  async get(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.proxy.proxy(
      "GET",
      `/adapters/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Patch(":id")
  async update(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Body() body: UpdateAdapterDto,
  ) {
    return this.proxy.proxy(
      "PATCH",
      `/adapters/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.proxy.proxy(
      "DELETE",
      `/adapters/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Post(":id/endpoints")
  @HttpCode(HttpStatus.CREATED)
  async addEndpoint(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Body() body: CreateEndpointDto,
  ) {
    return this.proxy.proxy(
      "POST",
      `/adapters/${encodeURIComponent(id)}/endpoints`,
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Delete(":id/endpoints/:epId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeEndpoint(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Param("epId") epId: string,
  ) {
    return this.proxy.proxy(
      "DELETE",
      `/adapters/${encodeURIComponent(id)}/endpoints/${encodeURIComponent(epId)}`,
      req[REQUEST_TENANT_KEY],
    );
  }
}
