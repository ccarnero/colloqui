import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TENANT_HEADER } from '@yoizen/shared';
import { JobsService } from './jobs.service';
import {
  CreateJobDto,
  UpdateJobDto,
  TriggerJobDto,
  ListJobsQueryDto,
  ListJobExecutionsQueryDto,
} from './jobs.dto';
import type { Job } from './jobs.repository';
import type { JobExecution } from './job-executions.repository';

@Controller('admin/jobs')
export class JobsController {
  constructor(private readonly service: JobsService) {}

  /**
   * Lista todos los jobs con filtros opcionales.
   * GET /admin/jobs?agent_id=xxx&is_active=true&limit=20&offset=0
   */
  @Get()
  async findAll(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query() query: ListJobsQueryDto,
  ): Promise<{ jobs: Job[]; total: number }> {
    return this.service.findAll(tenantId, {
      agent_id: query.agent_id,
      is_active: query.is_active,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Obtiene un job por su ID.
   * GET /admin/jobs/:id
   */
  @Get(':id')
  async findById(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<Job> {
    return this.service.findById(tenantId, id);
  }

  /**
   * Crea un nuevo job.
   * POST /admin/jobs
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers(TENANT_HEADER) tenantId: string,
    @Body() dto: CreateJobDto,
  ): Promise<Job> {
    return this.service.create(tenantId, {
      name: dto.name,
      agent_id: dto.agent_id,
      schedule: dto.schedule,
      payload: dto.payload,
      is_active: dto.is_active,
    });
  }

  /**
   * Actualiza un job existente.
   * PUT /admin/jobs/:id
   */
  @Put(':id')
  async update(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateJobDto,
  ): Promise<Job> {
    return this.service.update(tenantId, id, dto);
  }

  /**
   * Elimina un job.
   * DELETE /admin/jobs/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.delete(tenantId, id);
  }

  /**
   * Activa un job.
   * POST /admin/jobs/:id/enable
   */
  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  async enable(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<Job> {
    return this.service.enable(tenantId, id);
  }

  /**
   * Desactiva un job.
   * POST /admin/jobs/:id/disable
   */
  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  async disable(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<Job> {
    return this.service.disable(tenantId, id);
  }

  /**
   * Ejecuta un job manualmente.
   * POST /admin/jobs/:id/run
   */
  @Post(':id/run')
  @HttpCode(HttpStatus.CREATED)
  async run(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
  ): Promise<JobExecution> {
    return this.service.run(tenantId, id);
  }

  /**
   * Trigger un job con payload personalizado.
   * POST /admin/jobs/:id/trigger
   */
  @Post(':id/trigger')
  @HttpCode(HttpStatus.CREATED)
  async trigger(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param('id') id: string,
    @Body() dto: TriggerJobDto,
  ): Promise<JobExecution> {
    return this.service.trigger(tenantId, id, dto.event_payload);
  }

  /**
   * Lista las ejecuciones de jobs.
   * GET /admin/jobs/executions?job_id=xxx&status=running&limit=20&offset=0
   */
  @Get('executions')
  async findAllExecutions(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query() query: ListJobExecutionsQueryDto,
  ): Promise<{ executions: JobExecution[]; total: number }> {
    return this.service.findAllExecutions(tenantId, {
      job_id: query.job_id,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }
}
