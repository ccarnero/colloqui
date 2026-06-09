import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { JobsService } from "./jobs.service";
import {
  CreateJobDto,
  UpdateJobDto,
  TriggerJobDto,
  ListJobsQueryDto,
  ListJobExecutionsQueryDto,
} from "./jobs.dto";
import type { IJob } from "./jobs.repository.interface";
import type { IJobExecution } from "./job-executions.repository.interface";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";

@Controller("admin/jobs")
@UseGuards(TenantGuard)
export class JobsController {
  constructor(private readonly service: JobsService) {}

  /**
   * Lists jobs with optional filters.
   * GET /admin/jobs?agent_id=xxx&is_active=true&limit=20&offset=0
   */
  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @Query() query: ListJobsQueryDto,
  ): Promise<{ jobs: IJob[]; total: number }> {
    return this.service.findAll(tenantId, {
      agent_id: query.agent_id,
      is_active: query.is_active,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Lists job executions.
   * GET /admin/jobs/executions?job_id=xxx&status=running&limit=20&offset=0
   */
  @Get("executions")
  async findAllExecutions(
    @TenantId() tenantId: string,
    @Query() query: ListJobExecutionsQueryDto,
  ): Promise<{ executions: IJobExecution[]; total: number }> {
    return this.service.findAllExecutions(tenantId, {
      job_id: query.job_id,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Returns a job by ID.
   * GET /admin/jobs/:id
   */
  @Get(":id")
  async findById(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<IJob> {
    return this.service.findById(tenantId, id);
  }

  /**
   * Creates a job.
   * POST /admin/jobs
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateJobDto,
  ): Promise<IJob> {
    return this.service.create(tenantId, {
      name: dto.name,
      agent_id: dto.agent_id,
      schedule: dto.schedule,
      payload: dto.payload,
      is_active: dto.is_active,
    });
  }

  /**
   * Updates an existing job.
   * PUT /admin/jobs/:id
   */
  @Put(":id")
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateJobDto,
  ): Promise<IJob> {
    return this.service.update(tenantId, id, dto);
  }

  /**
   * Deletes a job.
   * DELETE /admin/jobs/:id
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<void> {
    await this.service.delete(tenantId, id);
  }

  /**
   * Enables a job.
   * POST /admin/jobs/:id/enable
   */
  @Post(":id/enable")
  @HttpCode(HttpStatus.OK)
  async enable(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<IJob> {
    return this.service.enable(tenantId, id);
  }

  /**
   * Disables a job.
   * POST /admin/jobs/:id/disable
   */
  @Post(":id/disable")
  @HttpCode(HttpStatus.OK)
  async disable(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<IJob> {
    return this.service.disable(tenantId, id);
  }

  /**
   * Runs a job manually.
   * POST /admin/jobs/:id/run
   */
  @Post(":id/run")
  @HttpCode(HttpStatus.CREATED)
  async run(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<IJobExecution> {
    return this.service.run(tenantId, id);
  }

  /**
   * Triggers a job with a custom payload.
   * POST /admin/jobs/:id/trigger
   */
  @Post(":id/trigger")
  @HttpCode(HttpStatus.CREATED)
  async trigger(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: TriggerJobDto,
  ): Promise<IJobExecution> {
    return this.service.trigger(tenantId, id, dto.event_payload);
  }
}
