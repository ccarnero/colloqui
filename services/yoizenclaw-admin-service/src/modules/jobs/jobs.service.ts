import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { JobsRepository, type Job, type CreateJobData, type UpdateJobData } from './jobs.repository';
import { JobExecutionsRepository, type JobExecution, type CreateExecutionData } from './job-executions.repository';
import { NatsPublisher } from '../../providers/nats.provider';

export interface FindAllJobsOptions {
  agent_id?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface FindAllExecutionsOptions {
  job_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly jobsRepository: JobsRepository,
    private readonly executionsRepository: JobExecutionsRepository,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  /**
   * Lista todos los jobs con filtros y paginación.
   */
  async findAll(
    tenantId: string,
    options: FindAllJobsOptions = {},
  ): Promise<{ jobs: Job[]; total: number }> {
    return this.jobsRepository.findAll(tenantId, options);
  }

  /**
   * Obtiene un job por su ID.
   */
  async findById(tenantId: string, id: string): Promise<Job> {
    const job = await this.jobsRepository.findById(tenantId, id);
    if (!job) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }
    return job;
  }

  /**
   * Crea un nuevo job.
   */
  async create(tenantId: string, data: CreateJobData): Promise<Job> {
    return this.jobsRepository.create(tenantId, data);
  }

  /**
   * Actualiza un job existente.
   */
  async update(
    tenantId: string,
    id: string,
    data: UpdateJobData,
  ): Promise<Job> {
    const job = await this.jobsRepository.update(tenantId, id, data);
    if (!job) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }
    return job;
  }

  /**
   * Elimina un job.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.jobsRepository.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }
  }

  /**
   * Activa un job.
   */
  async enable(tenantId: string, id: string): Promise<Job> {
    const job = await this.jobsRepository.enable(tenantId, id);
    if (!job) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }
    this.logger.log(`Job '${job.name}' enabled`);
    return job;
  }

  /**
   * Desactiva un job.
   */
  async disable(tenantId: string, id: string): Promise<Job> {
    const job = await this.jobsRepository.disable(tenantId, id);
    if (!job) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }
    this.logger.log(`Job '${job.name}' disabled`);
    return job;
  }

  /**
   * Ejecuta un job manualmente creando una ejecución.
   */
  async run(tenantId: string, id: string): Promise<JobExecution> {
    const job = await this.jobsRepository.findById(tenantId, id);
    if (!job) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }

    if (!job.is_active) {
      throw new BadRequestException(`Job '${job.name}' is not active`);
    }

    // Crear ejecución en estado running
    const executionData: CreateExecutionData = {
      job_id: id,
      status: 'running',
      triggered_by: 'manual',
    };

    const execution = await this.executionsRepository.create(tenantId, executionData);

    // Actualizar last_run del job
    await this.jobsRepository.updateLastRun(tenantId, id, job.schedule);

    this.logger.log(`Job '${job.name}' started manually, execution: ${execution.id}`);

    return execution;
  }

  /**
   * Trigger un job con payload personalizado emite evento NATS.
   */
  async trigger(
    tenantId: string,
    id: string,
    eventPayload: Record<string, unknown> = {},
  ): Promise<JobExecution> {
    const job = await this.jobsRepository.findById(tenantId, id);
    if (!job) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }

    if (!job.is_active) {
      throw new BadRequestException(`Job '${job.name}' is not active`);
    }

    // Crear ejecución en estado pending
    const executionData: CreateExecutionData = {
      job_id: id,
      status: 'pending',
      event_payload: eventPayload,
      triggered_by: 'event',
    };

    const execution = await this.executionsRepository.create(tenantId, executionData);

    // Emitir evento NATS
    try {
      await this.natsPublisher.publishJobTrigger(
        tenantId,
        job.id,
        execution.id,
        { ...job.payload, ...eventPayload },
      );
      this.logger.log(`Job '${job.name}' triggered, execution: ${execution.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to emit job.trigger event for job '${job.id}'`,
        error,
      );
      // No lanzamos error para no fallar la operación
    }

    return execution;
  }

  /**
   * Lista todas las ejecuciones de jobs.
   */
  async findAllExecutions(
    tenantId: string,
    options: FindAllExecutionsOptions = {},
  ): Promise<{ executions: JobExecution[]; total: number }> {
    return this.executionsRepository.findAll(tenantId, options);
  }

  /**
   * Obtiene una ejecución por su ID.
   */
  async findExecutionById(tenantId: string, id: string): Promise<JobExecution> {
    const execution = await this.executionsRepository.findById(tenantId, id);
    if (!execution) {
      throw new NotFoundException(`Job execution with ID '${id}' not found`);
    }
    return execution;
  }
}
