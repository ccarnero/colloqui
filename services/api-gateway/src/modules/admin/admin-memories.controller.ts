import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { AdminProxyService } from "./admin-proxy.service";
import { MemoryDecisionDto, MemoryProposalParamDto } from "./admin.dto";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { toOptionalStringQueryParam } from "../../utils/pagination-query.util";

@Controller("admin/memories")
export class AdminMemoriesController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get("proposals")
  async listProposals(
    @Req() req: ITenantScopedRequest,
    @Query("status") status?: string,
    @Query("kind") kind?: string,
    @Query("limit") limit?: number,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/memories/proposals",
      tenantId: req.tenantId,
      query: { status, kind, limit: toOptionalStringQueryParam(limit) },
      trustedUserId: req.user?.sub,
    });
  }

  @Post("proposals/:id/approve")
  @HttpCode(HttpStatus.OK)
  async approveProposal(
    @Req() req: ITenantScopedRequest,
    @Param() params: MemoryProposalParamDto,
    @Body() body: MemoryDecisionDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/memories/proposals/${params.id}/approve`,
      tenantId: req.tenantId,
      body,
      trustedUserId: req.user?.sub,
    });
  }

  @Post("proposals/:id/reject")
  @HttpCode(HttpStatus.OK)
  async rejectProposal(
    @Req() req: ITenantScopedRequest,
    @Param() params: MemoryProposalParamDto,
    @Body() body: MemoryDecisionDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/memories/proposals/${params.id}/reject`,
      tenantId: req.tenantId,
      body,
      trustedUserId: req.user?.sub,
    });
  }
}
