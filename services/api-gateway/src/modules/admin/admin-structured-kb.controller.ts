import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
// biome-ignore lint/style/useImportType: used as @Body() metatype — needed at runtime for ValidationPipe's class-validator/class-transformer reflection.
import { QueryStructuredKbDto } from "./admin.dto";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { AdminProxyService } from "./admin-proxy.service";

@ApiTags("structured-kb")
@Controller("admin/structured-kb")
export class AdminStructuredKBController {
  constructor(private readonly adminProxy: AdminProxyService) {}

  @Post("containers")
  async createContainer(
    @Req() req: ITenantScopedRequest,
    @Body() body: unknown
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "POST",
      path: "/admin/structured-kb/containers",
      tenantId: req.tenantId,
      body,
    });
  }

  @Get("containers")
  async listContainers(
    @Req() req: ITenantScopedRequest,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "GET",
      path: "/admin/structured-kb/containers",
      tenantId: req.tenantId,
    });
  }

  @Get("containers/:id")
  async getContainer(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "GET",
      path: `/admin/structured-kb/containers/${id}`,
      tenantId: req.tenantId,
    });
  }

  @Patch("containers/:id")
  async updateContainer(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "PATCH",
      path: `/admin/structured-kb/containers/${id}`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Delete("containers/:id")
  async deleteContainer(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "DELETE",
      path: `/admin/structured-kb/containers/${id}`,
      tenantId: req.tenantId,
    });
  }

  @Post("containers/:id/query")
  @HttpCode(HttpStatus.OK)
  async query(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: QueryStructuredKbDto
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "POST",
      path: `/admin/structured-kb/containers/${id}/query`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Post("containers/:id/files")
  async uploadFile(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "POST",
      path: `/admin/structured-kb/containers/${id}/files`,
      tenantId: req.tenantId,
      body,
    });
  }
}
