import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { toOptionalStringQueryParam } from "../../utils/pagination-query.util";
// biome-ignore lint/style/useImportType: used as @Body()/@Query() metatype — needed at runtime for ValidationPipe's class-validator/class-transformer reflection.
import {
  AdminAgentsListQueryDto,
  CreateAgentDto,
  UpdateAgentDto,
  UpdateEnabledMcpServersDto,
  UpdateEnabledMcpToolsDto,
  UpdateEnabledToolsDto,
  UpdateToolDescriptionOverridesDto,
} from "./admin.dto";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { AdminProxyService } from "./admin-proxy.service";

@ApiTags("agents")
@Controller("admin/agents")
export class AdminAgentsController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get()
  async listAgents(
    @Req() req: ITenantScopedRequest,
    @Query() query: AdminAgentsListQueryDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/agents",
      tenantId: req.tenantId,
      query: {
        status: query.status,
        is_active: query.is_active,
        limit: toOptionalStringQueryParam(query.limit),
        offset: toOptionalStringQueryParam(query.offset),
      },
    });
  }

  /**
   * Declared before `@Get(":id")` so Nest does not match
   * `memory-proposals` as an agent id.
   */
  @Get("memory-proposals")
  async listMemoryProposals(
    @Req() req: ITenantScopedRequest,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/agents/memory-proposals",
      tenantId: req.tenantId,
    });
  }

  @Get(":id/versions")
  async listVersions(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/admin/agents/${id}/versions`,
      tenantId: req.tenantId,
    });
  }

  @Get(":id")
  async getAgent(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/admin/agents/${id}`,
      tenantId: req.tenantId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createAgent(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateAgentDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: "/admin/agents",
      tenantId: req.tenantId,
      body,
    });
  }

  @Put(":id")
  async updateAgent(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateAgentDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PUT",
      path: `/admin/agents/${id}`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Delete(":id/versions/:versionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVersion(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("versionId", ParseUUIDPipe) versionId: string
  ): Promise<void> {
    await this.proxy.proxy({
      method: "DELETE",
      path: `/admin/agents/${id}/versions/${versionId}`,
      tenantId: req.tenantId,
    });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAgent(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string
  ): Promise<void> {
    await this.proxy.proxy({
      method: "DELETE",
      path: `/admin/agents/${id}`,
      tenantId: req.tenantId,
    });
  }

  @Post(":id/publish")
  @HttpCode(HttpStatus.OK)
  async publishAgent(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/agents/${id}/publish`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }

  @Post(":id/unpublish")
  @HttpCode(HttpStatus.OK)
  async unpublishAgent(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/agents/${id}/unpublish`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }

  @Post(":id/revert")
  @HttpCode(HttpStatus.OK)
  async revertAgent(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/agents/${id}/revert`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }

  /**
   * Declared with a static `memory-proposals` prefix (not under `:id/...`)
   * so Nest does not confuse it with an agent-id-scoped route.
   */
  @Post("memory-proposals/:id/approve")
  @HttpCode(HttpStatus.OK)
  async approveMemoryProposal(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/agents/memory-proposals/${encodeURIComponent(id)}/approve`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }

  /** @see {@link approveMemoryProposal} */
  @Post("memory-proposals/:id/reject")
  @HttpCode(HttpStatus.OK)
  async rejectMemoryProposal(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/agents/memory-proposals/${encodeURIComponent(id)}/reject`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }

  @Post(":id/versions/:versionId/rollback")
  @HttpCode(HttpStatus.OK)
  async rollbackToVersion(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("versionId", ParseUUIDPipe) versionId: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/agents/${id}/versions/${versionId}/rollback`,
      tenantId: req.tenantId,
    });
  }

  @Patch(":id/tools")
  @HttpCode(HttpStatus.OK)
  async updateEnabledTools(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateEnabledToolsDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/admin/agents/${id}/tools`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Patch(":id/mcp-servers")
  @HttpCode(HttpStatus.OK)
  async updateEnabledMcpServers(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateEnabledMcpServersDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/admin/agents/${id}/mcp-servers`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Patch(":id/mcp-tools")
  @HttpCode(HttpStatus.OK)
  async updateEnabledMcpTools(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateEnabledMcpToolsDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/admin/agents/${id}/mcp-tools`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Patch(":id/tool-descriptions")
  @HttpCode(HttpStatus.OK)
  async updateToolDescriptionOverrides(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateToolDescriptionOverridesDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/admin/agents/${id}/tool-descriptions`,
      tenantId: req.tenantId,
      body,
    });
  }
}
