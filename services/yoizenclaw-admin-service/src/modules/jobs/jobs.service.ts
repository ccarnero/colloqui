import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import {
  JobsRepository,
  type IJob,
  type ICreateJobData,
  type IUpdateJobData,
  type IFindAllJobsOptions,
} from "./jobs.repository";
import {
  JobExecutionsRepository,
  type IJobExecution,
  type ICreateExecutionData,
  type IFindAllExecutionsOptions,
} from "./job-executions.repository";
import { NatsPublisher } from "../../providers/nats.provider";
import { PinoLoggerService } from "@yoizen/observability";

@Injectable()
export class JobsService {
  private readonly logger = new PinoLoggerService(JobsService.name);

  constructor(
    private readonly jobsRepository: JobsRepository,
    private readonly executionsRepository: JobExecutionsRepository,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  /**
   * Lists all jobs with optional filters and pagination.
   */
  async findAll(
    tenantId: string,
    options: IFindAllJobsOptions = {},
  ): Promise<{ jobs: IJob[]; total: number }> {
    return this.jobsRepository.findAll(tenantId, options);
  }

  /**
   * Returns a job by ID.
   */
  async findById(tenantId: string, id: string): Promise<IJob> {
    const job = await this.jobsRepository.findById(tenantId, id);
    if (!job) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }
    return job;
  }

  /**
   * Creates a new job.
   */
  async create(tenantId: string, data: ICreateJobData): Promise<IJob> {
    return this.jobsRepository.create(tenantId, data);
  }

  /**
   * Updates an existing job.
   */
  async update(
    tenantId: string,
    id: string,
    data: IUpdateJobData,
  ): Promise<IJob> {
    const job = await this.jobsRepository.update(tenantId, id, data);
    if (!job) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }
    return job;
  }

  /**
   * Deletes a job.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.jobsRepository.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }
  }

  /**
   * Enables a job.
   */
  async enable(tenantId: string, id: string): Promise<IJob> {
    const job = await this.jobsRepository.enable(tenantId, id);
    if (!job) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }
    this.logger.log(`Job '${job.name}' enabled`);
    return job;
  }

  /**
   * Disables a job.
   */
  async disable(tenantId: string, id: string): Promise<IJob> {
    const job = await this.jobsRepository.disable(tenantId, id);
    if (!job) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }
    this.logger.log(`Job '${job.name}' disabled`);
    return job;
  }

  /**
   * Runs a job manually by creating an execution record.
   */
  async run(tenantId: string, id: string): Promise<IJobExecution> {
    const job = await this.jobsRepository.findById(tenantId, id);
    if (!job) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }

    if (!job.is_active) {
      throw new BadRequestException(`Job '${job.name}' is not active`);
    }

    // Create execution in running state
    const executionData: ICreateExecutionData = {
      job_id: id,
      status: "running",
      triggered_by: "manual",
    };

    const execution = await this.executionsRepository.create(
      tenantId,
      executionData,
    );

    // Update job last_run
    await this.jobsRepository.updateLastRun(tenantId, id, job.schedule);

    this.logger.log(
      `Job '${job.name}' started manually, execution: ${execution.id}`,
    );

    return execution;
  }

  /**
   * Triggers a job with a custom payload and emits a NATS event.
   */
  async trigger(
    tenantId: string,
    id: string,
    eventPayload: Record<string, unknown> = {},
  ): Promise<IJobExecution> {
    const job = await this.jobsRepository.findById(tenantId, id);
    if (!job) {
      throw new NotFoundException(`Job with ID '${id}' not found`);
    }

    if (!job.is_active) {
      throw new BadRequestException(`Job '${job.name}' is not active`);
    }

    // Create execution in pending state
    const executionData: ICreateExecutionData = {
      job_id: id,
      status: "pending",
      event_payload: eventPayload,
      triggered_by: "event",
    };

    const execution = await this.executionsRepository.create(
      tenantId,
      executionData,
    );

    // Emit NATS event
    try {
      await this.natsPublisher.publishJobTrigger({
        tenantId,
        jobId: job.id,
        executionId: execution.id,
        eventPayload: { ...job.payload, ...eventPayload },
      });
      this.logger.log(
        `Job '${job.name}' triggered, execution: ${execution.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit job.trigger event for job '${job.id}'`,
        error,
      );
      // Swallow errors so the trigger operation still succeeds
    }

    return execution;
  }

  /**
   * Lists all job executions.
   */
  async findAllExecutions(
    tenantId: string,
    options: IFindAllExecutionsOptions = {},
  ): Promise<{ executions: IJobExecution[]; total: number }> {
    return this.executionsRepository.findAll(tenantId, options);
  }
}
