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
import { CreateJobDto, UpdateJobDto, TriggerJobDto } from './admin.dto';

interface TenantRequest extends Request {
  tenantId: string;
}

@Controller('admin/jobs')
export class AdminJobsController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get()
  async listJobs(
    @Req() req: TenantRequest,
    @Query('agent_id') agentId?: string,
    @Query('is_active') isActive?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<object> {
    return this.proxy.proxy('GET', '/admin/jobs', req.tenantId, {
      agent_id: agentId,
      is_active: isActive,
      limit,
      offset,
    });
  }

  @Get('executions')
  async listExecutions(
    @Req() req: TenantRequest,
    @Query('job_id') jobId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<object> {
    return this.proxy.proxy('GET', '/admin/jobs/executions', req.tenantId, {
      job_id: jobId,
      status,
      limit,
      offset,
    });
  }

  @Get(':id')
  async getJob(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy('GET', `/admin/jobs/${id}`, req.tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createJob(
    @Req() req: TenantRequest,
    @Body() body: CreateJobDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'POST',
      '/admin/jobs',
      req.tenantId,
      undefined,
      body,
    );
  }

  @Put(':id')
  async updateJob(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateJobDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'PUT',
      `/admin/jobs/${id}`,
      req.tenantId,
      undefined,
      body,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteJob(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.proxy.proxy('DELETE', `/admin/jobs/${id}`, req.tenantId);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  async enableJob(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy('POST', `/admin/jobs/${id}/enable`, req.tenantId);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  async disableJob(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy('POST', `/admin/jobs/${id}/disable`, req.tenantId);
  }

  @Post(':id/run')
  @HttpCode(HttpStatus.CREATED)
  async runJob(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy('POST', `/admin/jobs/${id}/run`, req.tenantId);
  }

  @Post(':id/trigger')
  @HttpCode(HttpStatus.CREATED)
  async triggerJob(
    @Req() req: TenantRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TriggerJobDto,
  ): Promise<object> {
    return this.proxy.proxy(
      'POST',
      `/admin/jobs/${id}/trigger`,
      req.tenantId,
      undefined,
      body,
    );
  }
}
