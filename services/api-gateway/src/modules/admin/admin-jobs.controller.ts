import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  AdminJobExecutionsListQueryDto,
  AdminJobsListQueryDto,
  CreateJobDto,
  TriggerJobDto,
  UpdateJobDto,
} from "./admin.dto";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { AdminProxyService } from "./admin-proxy.service";

@ApiTags("jobs")
@Controller("admin/jobs")
export class AdminJobsController {
  constructor(private readonly proxy: AdminProxyService) {}

  @Get()
  async listJobs(
    @Req() req: ITenantScopedRequest,
    @Query() query: AdminJobsListQueryDto
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
    @Query() query: AdminJobExecutionsListQueryDto
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
    @Param("id", ParseUUIDPipe) id: string
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
    @Body() body: CreateJobDto
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
    @Body() body: UpdateJobDto
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
    @Param("id", ParseUUIDPipe) id: string
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
    @Param("id", ParseUUIDPipe) id: string
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
    @Param("id", ParseUUIDPipe) id: string
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
    @Param("id", ParseUUIDPipe) id: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/jobs/${id}/run`,
      tenantId: req.tenantId,
    });
  }

  /**
   * The external gateway field stays named `payload` for API stability,
   * but agent-admin-service's trigger endpoint reads `event_payload` from
   * the body — renaming it here avoids silently dropping the payload.
   */
  @Post(":id/trigger")
  @HttpCode(HttpStatus.CREATED)
  async triggerJob(
    @Req() req: ITenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: TriggerJobDto
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: `/admin/jobs/${id}/trigger`,
      tenantId: req.tenantId,
      body: { event_payload: body.payload },
    });
  }
}
