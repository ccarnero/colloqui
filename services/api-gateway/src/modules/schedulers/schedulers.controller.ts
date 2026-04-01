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
import { CreateScheduleDto, UpdateScheduleDto } from "./schedulers.dto";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { TenantScopedRequest } from "../../types/yoizen-request";

@Controller("schedulers")
export class SchedulersController {
  constructor(private readonly proxy: SchedulerProxyService) {}

  @Post("schedules")
  async createSchedule(
    @Req() req: TenantScopedRequest,
    @Body() body: CreateScheduleDto,
  ) {
    return this.proxy.proxy(
      "POST",
      "/schedules",
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Get("schedules")
  async listSchedules(
    @Req() req: TenantScopedRequest,
    @Query("enabled") enabled?: string,
    @Query("type") type?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.proxy.proxy(
      "GET",
      "/schedules",
      req[REQUEST_TENANT_KEY],
      { enabled, type, limit, offset },
    );
  }

  @Get("schedules/:id")
  async getSchedule(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "GET",
      `/schedules/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Patch("schedules/:id")
  async updateSchedule(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Body() body: UpdateScheduleDto,
  ) {
    return this.proxy.proxy(
      "PATCH",
      `/schedules/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Delete("schedules/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSchedule(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "DELETE",
      `/schedules/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Post("schedules/:id/trigger")
  async triggerSchedule(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "POST",
      `/schedules/${encodeURIComponent(id)}/trigger`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Get("schedules/:scheduleId/executions")
  async listScheduleExecutions(
    @Req() req: TenantScopedRequest,
    @Param("scheduleId") scheduleId: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.proxy.proxy(
      "GET",
      `/schedules/${encodeURIComponent(scheduleId)}/executions`,
      req[REQUEST_TENANT_KEY],
      { status, limit, offset },
    );
  }

  @Get("executions")
  async listExecutions(
    @Req() req: TenantScopedRequest,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.proxy.proxy(
      "GET",
      "/executions",
      req[REQUEST_TENANT_KEY],
      { status, limit, offset },
    );
  }

  @Get("executions/:id")
  async getExecution(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "GET",
      `/executions/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
    );
  }
}
