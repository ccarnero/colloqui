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
import { REQUEST_TENANT_KEY } from '../../guards/tenant.guard';
import { CreateAgentDto, UpdateAgentDto } from './admin.dto';

interface TenantRequest extends Request {
  tenantId: string;
}

@Controller('admin/agents')
export class AdminAgentsController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get()
  async listAgents(
    @Req() req: TenantRequest,
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

  @Get(':id')
  async getAgent(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy('GET', `/admin/agents/${id}`, req.tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createAgent(
    @Req() req: TenantRequest,
    @Body() body: CreateAgentDto,
  ): Promise<object> {
    return this.proxy.proxy('POST', '/admin/agents', req.tenantId, undefined, body);
  }

  @Put(':id')
  async updateAgent(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAgentDto,
  ): Promise<object> {
    return this.proxy.proxy('PUT', `/admin/agents/${id}`, req.tenantId, undefined, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAgent(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.proxy.proxy('DELETE', `/admin/agents/${id}`, req.tenantId);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publishAgent(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy('POST', `/admin/agents/${id}/publish`, req.tenantId);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  async unpublishAgent(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy('POST', `/admin/agents/${id}/unpublish`, req.tenantId);
  }
}
