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
  CreateJobDto,
  UpdateJobDto,
  TriggerJobDto,
  AdminJobsListQueryDto,
  AdminJobExecutionsListQueryDto,
} from "./admin.dto";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { toOptionalStringQueryParam } from "../../utils/pagination-query.util";

@Controller("admin/jobs")
export class AdminJobsController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get()
  async listJobs(
    @Req() req: ITenantScopedRequest,
    @Query() query: AdminJobsListQueryDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/jobs",
      tenantId: req.tenantId,
      query: {
        agent_id: query.agent_id,
        is_active: query.is_active,
        limit: toOptionalStringQueryParam(query.limit),
        offset: toOptionalStringQueryParam(query.offset),
      },
    });
  }

  @Get("executions")
  async listExecutions(
    @Req() req: ITenantScopedRequest,
    @Query() query: AdminJobExecutionsListQueryDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/jobs/executions",
      tenantId: req.tenantId,
      query: {
        job_id: query.job_id,
        status: query.status,
        limit: toOptionalStringQueryParam(query.limit),
        offset: toOptionalStringQueryParam(query.offset),
      },
    });
  }

  @Get(":id")
  async getJob(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/admin/jobs/${id}`,
      tenantId: req.tenantId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createJob(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateJobDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: "/admin/jobs",
      tenantId: req.tenantId,
      body,
    });
  }

  @Put(":id")
  async updateJob(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateJobDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PUT",
      path: `/admin/jobs/${id}`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteJob(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.proxy.proxy({
      method: "DELETE",
      path: `/admin/jobs/${id}`,
      tenantId: req.tenantId,
    });
  }

  @Post(":id/enable")
  @HttpCode(HttpStatus.OK)
  async enableJob(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/jobs/${id}/enable`,
      tenantId: req.tenantId,
    });
  }

  @Post(":id/disable")
  @HttpCode(HttpStatus.OK)
  async disableJob(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/jobs/${id}/disable`,
      tenantId: req.tenantId,
    });
  }

  @Post(":id/run")
  @HttpCode(HttpStatus.CREATED)
  async runJob(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/jobs/${id}/run`,
      tenantId: req.tenantId,
    });
  }

  @Post(":id/trigger")
  @HttpCode(HttpStatus.CREATED)
  async triggerJob(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: TriggerJobDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/jobs/${id}/trigger`,
      tenantId: req.tenantId,
      body,
    });
  }
}
