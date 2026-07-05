import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AdminProxyService } from "./admin-proxy.service";
import {
  UpsertConfigFileDto,
  DeployConfigFilesDto,
  AdminConfigFilesListQueryDto,
  ConfigFilePathQueryDto,
} from "./admin.dto";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { toOptionalStringQueryParam } from "../../utils/pagination-query.util";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("config-files", "templates", "runtime")
@Controller("admin")
export class AdminConfigController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get("config-files")
  async listConfigFiles(
    @Req() req: ITenantScopedRequest,
    @Query() query: AdminConfigFilesListQueryDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/config-files",
      tenantId: req.tenantId,
      query: {
        limit: toOptionalStringQueryParam(query.limit),
        offset: toOptionalStringQueryParam(query.offset),
      },
    });
  }

  @Get("config-files/file")
  async getConfigFileByPath(
    @Req() req: ITenantScopedRequest,
    @Query() query: ConfigFilePathQueryDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/config-files/file",
      tenantId: req.tenantId,
      query: { path: query.path },
    });
  }

  @Put("config-files")
  async upsertConfigFile(
    @Req() req: ITenantScopedRequest,
    @Body() body: UpsertConfigFileDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PUT",
      path: "/admin/config-files",
      tenantId: req.tenantId,
      body,
    });
  }

  @Post("config-files/deploy")
  @HttpCode(HttpStatus.OK)
  async deployConfigFiles(
    @Req() req: ITenantScopedRequest,
    @Body() body: DeployConfigFilesDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: "/admin/config-files/deploy",
      tenantId: req.tenantId,
      body,
    });
  }

  @Get("runtime/status")
  async getRuntimeStatus(@Req() req: ITenantScopedRequest): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/runtime/status",
      tenantId: req.tenantId,
    });
  }

  @Get("templates")
  async listTemplates(@Req() req: ITenantScopedRequest): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/templates",
      tenantId: req.tenantId,
    });
  }
}
