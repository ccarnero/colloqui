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
  ChatRequestDto,
  CreateAgentDto,
  MemoryProposalParamDto,
  AdminAgentsListQueryDto,
  UpdateAgentDto,
} from "./admin.dto";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { toOptionalStringQueryParam } from "../../utils/pagination-query.util";

@Controller("admin/agents")
export class AdminAgentsController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get()
  async listAgents(
    @Req() req: ITenantScopedRequest,
    @Query() query: AdminAgentsListQueryDto,
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

  @Get("memory-proposals")
  async listMemoryProposals(
    @Req() req: ITenantScopedRequest,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/agents/memory-proposals",
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }

  @Get(":id")
  async getAgent(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
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
    @Body() body: CreateAgentDto,
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
    @Body() body: UpdateAgentDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PUT",
      path: `/admin/agents/${id}`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAgent(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
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
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/agents/${id}/publish`,
      tenantId: req.tenantId,
    });
  }

  @Post(":id/unpublish")
  @HttpCode(HttpStatus.OK)
  async unpublishAgent(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/agents/${id}/unpublish`,
      tenantId: req.tenantId,
    });
  }

  @Post(":id/chat")
  @HttpCode(HttpStatus.OK)
  async chatWithAgent(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ChatRequestDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/agents/${id}/chat`,
      tenantId: req.tenantId,
      body,
      trustedUserId: req.user?.sub,
    });
  }

  @Post("memory-proposals/:id/approve")
  @HttpCode(HttpStatus.OK)
  async approveMemoryProposal(
    @Req() req: ITenantScopedRequest,
    @Param() params: MemoryProposalParamDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/agents/memory-proposals/${params.id}/approve`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }

  @Post("memory-proposals/:id/reject")
  @HttpCode(HttpStatus.OK)
  async rejectMemoryProposal(
    @Req() req: ITenantScopedRequest,
    @Param() params: MemoryProposalParamDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/agents/memory-proposals/${params.id}/reject`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }
}
