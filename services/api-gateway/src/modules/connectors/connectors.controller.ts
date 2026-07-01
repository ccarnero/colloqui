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
import { ConnectorsProxyService } from "./connectors-proxy.service";
import {
  CreateAdapterDto,
  CreateEndpointDto,
  UpdateAdapterDto,
  UpdateEndpointDto,
} from "./connectors.dto";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { ITenantScopedRequest } from "../../types/yoizen-request";

@Controller("connectors")
export class ConnectorsController {
  constructor(private readonly proxy: ConnectorsProxyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateAdapterDto,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: "/connectors",
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
      path: "/connectors",
      tenantId: req[REQUEST_TENANT_KEY],
      query: { context, tag },
    });
  }

  @Get("usage")
  async usage(
    @Req() req: ITenantScopedRequest,
    @Query("window") window?: string,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: "/connectors/usage",
      tenantId: req[REQUEST_TENANT_KEY],
      query: { window },
    });
  }

  @Get(":id")
  async get(@Req() req: ITenantScopedRequest, @Param("id") id: string) {
    return this.proxy.proxy({
      method: "GET",
      path: `/connectors/${encodeURIComponent(id)}`,
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
      path: `/connectors/${encodeURIComponent(id)}`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: ITenantScopedRequest, @Param("id") id: string) {
    return this.proxy.proxy({
      method: "DELETE",
      path: `/connectors/${encodeURIComponent(id)}`,
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
      path: `/connectors/${encodeURIComponent(id)}/endpoints`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Patch(":id/endpoints/:epId")
  async updateEndpoint(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Param("epId") epId: string,
    @Body() body: UpdateEndpointDto,
  ) {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/connectors/${encodeURIComponent(id)}/endpoints/${encodeURIComponent(epId)}`,
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
      path: `/connectors/${encodeURIComponent(id)}/endpoints/${encodeURIComponent(epId)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }
}
