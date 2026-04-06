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
} from '@nestjs/common';
import { AdminProxyService } from './admin-proxy.service';
import {
  MemoryDecisionDto,
  MemoryProposalParamDto,
} from './admin.dto';
import type { TenantScopedRequest } from '../../types/yoizen-request';

@Controller('admin/memories')
export class AdminMemoriesController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get('proposals')
  async listProposals(
    @Req() req: TenantScopedRequest,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
  ): Promise<object> {
    return this.proxy.proxy(
      'GET',
      '/admin/memories/proposals',
      req.tenantId,
      { status, kind, limit },
      undefined,
      req.user?.sub,
    );
  }

  @Post('proposals/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveProposal(
    @Req() req: TenantScopedRequest,
    @Param() params: MemoryProposalParamDto,
    @Body() body: MemoryDecisionDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'POST',
      `/admin/memories/proposals/${params.id}/approve`,
      req.tenantId,
      undefined,
      body,
      req.user?.sub,
    );
  }

  @Post('proposals/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectProposal(
    @Req() req: TenantScopedRequest,
    @Param() params: MemoryProposalParamDto,
    @Body() body: MemoryDecisionDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'POST',
      `/admin/memories/proposals/${params.id}/reject`,
      req.tenantId,
      undefined,
      body,
      req.user?.sub,
    );
  }
}
