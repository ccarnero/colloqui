import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { SchedulerProxyService } from "./schedulers.service";
import {
  CreateScheduleDto,
  ListExecutionsQueryProxyDto,
  ListSchedulesQueryProxyDto,
  UpdateScheduleDto,
} from "./schedulers.dto";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { ITenantScopedRequest } from "../../types/yoizen-request";

@Controller("schedulers")
export class SchedulersController {
  constructor(private readonly proxy: SchedulerProxyService) {}

  @Post("schedules")
  async createSchedule(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateScheduleDto,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: "/schedules",
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Get("schedules")
  async listSchedules(
    @Req() req: ITenantScopedRequest,
    @Query() query: ListSchedulesQueryProxyDto,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: "/schedules",
      tenantId: req[REQUEST_TENANT_KEY],
      query: {
        enabled: query.enabled,
        type: query.type,
        limit: query.limit !== undefined ? String(query.limit) : undefined,
        offset: query.offset !== undefined ? String(query.offset) : undefined,
      },
    });
  }

  @Get("schedules/:id")
  async getSchedule(@Req() req: ITenantScopedRequest, @Param("id") id: string) {
    return this.proxy.proxy({
      method: "GET",
      path: `/schedules/${encodeURIComponent(id)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Patch("schedules/:id")
  async updateSchedule(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: UpdateScheduleDto,
  ) {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/schedules/${encodeURIComponent(id)}`,
      tenantId: req[REQUEST_TENANT_KEY],
      body,
    });
  }

  @Delete("schedules/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSchedule(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "DELETE",
      path: `/schedules/${encodeURIComponent(id)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Post("schedules/:id/trigger")
  async triggerSchedule(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: `/schedules/${encodeURIComponent(id)}/trigger`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }

  @Get("schedules/:scheduleId/executions")
  async listScheduleExecutions(
    @Req() req: ITenantScopedRequest,
    @Param("scheduleId") scheduleId: string,
    @Query() query: ListExecutionsQueryProxyDto,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: `/schedules/${encodeURIComponent(scheduleId)}/executions`,
      tenantId: req[REQUEST_TENANT_KEY],
      query: {
        status: query.status,
        limit: query.limit !== undefined ? String(query.limit) : undefined,
        offset: query.offset !== undefined ? String(query.offset) : undefined,
      },
    });
  }

  @Get("executions")
  async listExecutions(
    @Req() req: ITenantScopedRequest,
    @Query() query: ListExecutionsQueryProxyDto,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: "/executions",
      tenantId: req[REQUEST_TENANT_KEY],
      query: {
        status: query.status,
        limit: query.limit !== undefined ? String(query.limit) : undefined,
        offset: query.offset !== undefined ? String(query.offset) : undefined,
      },
    });
  }

  @Get("executions/:id")
  async getExecution(@Req() req: ITenantScopedRequest, @Param("id") id: string) {
    return this.proxy.proxy({
      method: "GET",
      path: `/executions/${encodeURIComponent(id)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }
}
