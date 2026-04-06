import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from "@nestjs/common";
import { AdminProxyService } from "./admin-proxy.service";
import {
  CreateCredentialDto,
  UpdateCredentialDto,
  RotateCredentialDto,
  AdminCredentialsListQueryDto,
} from "./admin.dto";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { toOptionalStringQueryParam } from "../../utils/pagination-query.util";

@Controller("admin/credentials")
export class AdminCredentialsController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get("providers")
  async getProviders(
    @Req() req: ITenantScopedRequest,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/credentials/providers",
      tenantId: req.tenantId,
    });
  }

  @Get()
  async listCredentials(
    @Req() req: ITenantScopedRequest,
    @Query() query: AdminCredentialsListQueryDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/credentials",
      tenantId: req.tenantId,
      query: {
        type: query.type,
        is_active: query.is_active,
        limit: toOptionalStringQueryParam(query.limit),
        offset: toOptionalStringQueryParam(query.offset),
      },
    });
  }

  @Get(":id")
  async getCredential(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/admin/credentials/${id}`,
      tenantId: req.tenantId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCredential(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateCredentialDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: "/admin/credentials",
      tenantId: req.tenantId,
      body,
    });
  }

  @Put(":id")
  async updateCredential(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateCredentialDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PUT",
      path: `/admin/credentials/${id}`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCredential(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.proxy.proxy({
      method: "DELETE",
      path: `/admin/credentials/${id}`,
      tenantId: req.tenantId,
    });
  }

  @Put(":id/rotate")
  async rotateCredential(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: RotateCredentialDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PUT",
      path: `/admin/credentials/${id}/rotate`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Post("sync")
  @HttpCode(HttpStatus.ACCEPTED)
  async syncCredentials(
    @Req() req: ITenantScopedRequest,
    @Body() body?: object,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: "/admin/credentials/sync",
      tenantId: req.tenantId,
      body,
    });
  }
}
