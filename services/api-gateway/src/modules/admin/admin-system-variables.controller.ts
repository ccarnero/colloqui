import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
} from "@nestjs/common";
import { AdminProxyService } from "./admin-proxy.service";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("system-variables")
@Controller("admin/system-variables")
export class AdminSystemVariablesController {
  constructor(private readonly adminProxy: AdminProxyService) {}

  @Get()
  async findAll(
    @Req() req: ITenantScopedRequest,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "GET",
      path: "/admin/system-variables",
      tenantId: req.tenantId,
      query: { limit, offset },
    });
  }

  @Get(":id")
  async findById(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "GET",
      path: `/admin/system-variables/${id}`,
      tenantId: req.tenantId,
    });
  }

  @Post()
  async create(
    @Req() req: ITenantScopedRequest,
    @Body() body: unknown,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "POST",
      path: "/admin/system-variables",
      tenantId: req.tenantId,
      body,
    });
  }

  @Patch(":id")
  async update(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "PATCH",
      path: `/admin/system-variables/${id}`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Delete(":id")
  async delete(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "DELETE",
      path: `/admin/system-variables/${id}`,
      tenantId: req.tenantId,
    });
  }
}
