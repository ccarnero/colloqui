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
  Query,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
// biome-ignore lint/style/useImportType: used as @Body()/@Param() metatype — needed at runtime for ValidationPipe's class-validator/class-transformer reflection.
import {
  CreateMcpServerDto,
  McpServerIdParamDto,
  UpdateMcpServerDto,
} from "./admin.dto";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { AdminProxyService } from "./admin-proxy.service";

@ApiTags("mcp-servers")
@Controller("admin/mcp-servers")
export class AdminMcpServersController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get()
  async listMcpServers(@Req() req: ITenantScopedRequest): Promise<object> {
    return this.proxy.proxy({ method: "GET", path: "/admin/mcp-servers", tenantId: req.tenantId });
  }

  /**
   * Declared before `@Get(":id")` — Nest matches the more specific
   * `:id/tools` path first regardless, but kept adjacent to `getMcpServer`
   * for readability (mcp-connections.md §2.4).
   */
  @Get(":id/tools")
  async listMcpServerTools(
    @Req() req: ITenantScopedRequest,
    @Param() params: McpServerIdParamDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/admin/mcp-servers/${params.id}/tools`,
      tenantId: req.tenantId,
    });
  }

  @Get(":id")
  async getMcpServer(
    @Req() req: ITenantScopedRequest,
    @Param() params: McpServerIdParamDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/admin/mcp-servers/${params.id}`,
      tenantId: req.tenantId,
    });
  }

  /**
   * Usage summary + recent calls proxy for the MCP detail page
   * (mcp-connections.md §3, §6.3). The write side
   * (`POST admin/mcp-servers/usage-events`) is intentionally NOT proxied
   * here — it's service-to-service traffic (agent-ai-service ->
   * agent-admin-service directly), not an admin-console-facing endpoint.
   */
  @Get(":id/usage")
  async getMcpServerUsage(
    @Req() req: ITenantScopedRequest,
    @Param() params: McpServerIdParamDto,
    @Query("window") window?: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/admin/mcp-servers/${params.id}/usage`,
      tenantId: req.tenantId,
      query: window ? { window } : undefined,
    });
  }

  /**
   * Live connectivity test proxy (mcp-connections.md §2.2). No request
   * body — same passthrough pattern as `listMcpServerTools`.
   */
  @Post(":id/test")
  @HttpCode(HttpStatus.OK)
  async testMcpServerConnection(
    @Req() req: ITenantScopedRequest,
    @Param() params: McpServerIdParamDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/mcp-servers/${params.id}/test`,
      tenantId: req.tenantId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createMcpServer(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateMcpServerDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: "/admin/mcp-servers",
      tenantId: req.tenantId,
      body,
    });
  }

  /**
   * `PATCH`, not `PUT` — mirrors the downstream fix in `agent-admin-service`'s
   * `McpServersController` (mcp-connections.md §2.1).
   */
  @Patch(":id")
  async updateMcpServer(
    @Req() req: ITenantScopedRequest,
    @Param() params: McpServerIdParamDto,
    @Body() body: UpdateMcpServerDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/admin/mcp-servers/${params.id}`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMcpServer(
    @Req() req: ITenantScopedRequest,
    @Param() params: McpServerIdParamDto
  ): Promise<void> {
    await this.proxy.proxy({
      method: "DELETE",
      path: `/admin/mcp-servers/${params.id}`,
      tenantId: req.tenantId,
    });
  }
}
