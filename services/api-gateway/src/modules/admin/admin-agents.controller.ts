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
} from '@nestjs/common';
import { AdminProxyService } from './admin-proxy.service';
import {
  ChatRequestDto,
  CreateAgentDto,
  MemoryProposalParamDto,
  UpdateAgentDto,
} from './admin.dto';
import type { TenantScopedRequest } from '../../types/yoizen-request';

@Controller('admin/agents')
export class AdminAgentsController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get()
  async listAgents(
    @Req() req: TenantScopedRequest,
    @Query('status') status?: string,
    @Query('is_active') isActive?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<object> {
    return this.proxy.proxy(
      'GET',
      '/admin/agents',
      req.tenantId,
      { status, is_active: isActive, limit, offset },
    );
  }

  @Get('memory-proposals')
  async listMemoryProposals(
    @Req() req: TenantScopedRequest,
  ): Promise<object> {
    return this.proxy.proxy(
      'GET',
      '/admin/agents/memory-proposals',
      req.tenantId,
      undefined,
      undefined,
      req.user?.sub,
    );
  }

  @Get(':id')
  async getAgent(
    @Req() req: TenantScopedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy('GET', `/admin/agents/${id}`, req.tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createAgent(
    @Req() req: TenantScopedRequest,
    @Body() body: CreateAgentDto,
  ): Promise<object> {
    return this.proxy.proxy('POST', '/admin/agents', req.tenantId, undefined, body);
  }

  @Put(':id')
  async updateAgent(
    @Req() req: TenantScopedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAgentDto,
  ): Promise<object> {
    return this.proxy.proxy('PUT', `/admin/agents/${id}`, req.tenantId, undefined, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAgent(
    @Req() req: TenantScopedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.proxy.proxy('DELETE', `/admin/agents/${id}`, req.tenantId);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publishAgent(
    @Req() req: TenantScopedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy('POST', `/admin/agents/${id}/publish`, req.tenantId);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  async unpublishAgent(
    @Req() req: TenantScopedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy('POST', `/admin/agents/${id}/unpublish`, req.tenantId);
  }

  @Post(':id/chat')
  @HttpCode(HttpStatus.OK)
  async chatWithAgent(
    @Req() req: TenantScopedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChatRequestDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'POST',
      `/admin/agents/${id}/chat`,
      req.tenantId,
      undefined,
      body,
      req.user?.sub,
    );
  }

  @Post('memory-proposals/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveMemoryProposal(
    @Req() req: TenantScopedRequest,
    @Param() params: MemoryProposalParamDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'POST',
      `/admin/agents/memory-proposals/${params.id}/approve`,
      req.tenantId,
      undefined,
      undefined,
      req.user?.sub,
    );
  }

  @Post('memory-proposals/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectMemoryProposal(
    @Req() req: TenantScopedRequest,
    @Param() params: MemoryProposalParamDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'POST',
      `/admin/agents/memory-proposals/${params.id}/reject`,
      req.tenantId,
      undefined,
      undefined,
      req.user?.sub,
    );
  }
}
