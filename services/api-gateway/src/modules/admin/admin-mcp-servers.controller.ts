import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AdminProxyService } from "./admin-proxy.service";
import { CreateMcpServerDto, UpdateMcpServerDto, McpServerIdParamDto } from "./admin.dto";
import type { ITenantScopedRequest } from "../../types/yoizen-request";

@Controller("admin/mcp-servers")
export class AdminMcpServersController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get()
  async listMcpServers(@Req() req: ITenantScopedRequest): Promise<object> {
    return this.proxy.proxy({ method: "GET", path: "/admin/mcp-servers", tenantId: req.tenantId });
  }

  @Get(":id")
  async getMcpServer(
    @Req() req: ITenantScopedRequest,
    @Param() params: McpServerIdParamDto,
  ): Promise<object> {
    return this.proxy.proxy({ method: "GET", path: `/admin/mcp-servers/${params.id}`, tenantId: req.tenantId });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createMcpServer(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateMcpServerDto,
  ): Promise<object> {
    return this.proxy.proxy({ method: "POST", path: "/admin/mcp-servers", tenantId: req.tenantId, body });
  }

  @Put(":id")
  async updateMcpServer(
    @Req() req: ITenantScopedRequest,
    @Param() params: McpServerIdParamDto,
    @Body() body: UpdateMcpServerDto,
  ): Promise<object> {
    return this.proxy.proxy({ method: "PUT", path: `/admin/mcp-servers/${params.id}`, tenantId: req.tenantId, body });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMcpServer(
    @Req() req: ITenantScopedRequest,
    @Param() params: McpServerIdParamDto,
  ): Promise<void> {
    await this.proxy.proxy({ method: "DELETE", path: `/admin/mcp-servers/${params.id}`, tenantId: req.tenantId });
  }
}
