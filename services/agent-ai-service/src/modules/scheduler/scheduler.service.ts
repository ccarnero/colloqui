import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { LeaderElectionService } from "./leader-election.service";
import {
  TriggerManagerService,
  type JobDefinition,
  type ScheduleType,
} from "./trigger-manager.service";

export interface JobExecution {
  readonly id: string;
  readonly jobId: string;
  readonly triggeredBy: "manual" | "schedule" | "event";
  readonly eventPayload?: Record<string, unknown>;
  readonly startedAt: Date;
  finishedAt?: Date;
  readonly status: "running" | "completed" | "failed" | "skipped";
  errorMessage?: string;
}

@Injectable()
export class SchedulerService implements OnModuleDestroy {
  private readonly logger = new PinoLoggerService(SchedulerService.name);
  private readonly activeJobs = new Map<string, JobDefinition>();
  private readonly executions = new Map<string, JobExecution>();
  private running = false;

  constructor(
    private readonly triggerManager: TriggerManagerService,
    private readonly leaderElection: LeaderElectionService,
  ) {}

  async initialize(): Promise<void> {
    this.logger.log("Initializing internal scheduler");
    // Jobs are registered via scheduleJob() calls.
    // Persisted job loading from DB is left to the caller
    // (e.g. a config-sync or job-executor module).
  }

  async start(): Promise<void> {
    const leaderPgUrl = process.env.LEADER_ELECTION_POSTGRES_URL;

    if (leaderPgUrl) {
      const acquired =
        await this.leaderElection.tryAcquireLeadership(leaderPgUrl);

      if (!acquired) {
        this.logger.warn(
          "Not the leader — scheduler will only handle event and manual triggers",
        );
      }
    }

    this.running = true;
    this.logger.log("Internal scheduler started");
  }

  async stop(): Promise<void> {
    this.triggerManager.stopAll();
    this.activeJobs.clear();
    this.running = false;
    this.logger.log("Internal scheduler stopped");
  }

  scheduleJob(job: JobDefinition): void {
    this.activeJobs.set(job.id, job);

    if (!job.enabled) {
      this.logger.debug(`Job '${job.id}' is disabled — not scheduling`);
      return;
    }

    this.triggerManager.scheduleJob(job, (jobId) =>
      this.executeJobWrapper(jobId),
    );
    this.logger.debug(`Scheduled job '${job.id}' (type: ${job.scheduleType})`);
  }

  unscheduleJob(jobId: string): void {
    this.triggerManager.unscheduleJob(jobId);
    this.activeJobs.delete(jobId);
    this.logger.debug(`Unscheduled job '${jobId}'`);
  }

  async triggerJob(
    jobId: string,
    eventPayload?: Record<string, unknown>,
  ): Promise<JobExecution | null> {
    const job = this.activeJobs.get(jobId);
    if (!job || !job.enabled) {
      return null;
    }

    const execution: JobExecution = {
      id: crypto.randomUUID(),
      jobId,
      triggeredBy: "manual",
      eventPayload,
      startedAt: new Date(),
      status: "running",
    };

    this.executions.set(execution.id, execution);

    // Fire-and-forget execution, same as the Python pattern
    this.executeJobSafely(job, execution).catch(() => {
      // Error already handled in executeJobSafely
    });

    return execution;
  }

  async emitEvent(
    eventName: string,
    payload: Record<string, unknown>,
  ): Promise<number> {
    const jobs = this.triggerManager.getEventJobs(eventName);
    const enabledJobs = jobs.filter((j) => j.enabled);

    for (const job of enabledJobs) {
      const execution: JobExecution = {
        id: crypto.randomUUID(),
        jobId: job.id,
        triggeredBy: "event",
        eventPayload: payload,
        startedAt: new Date(),
        status: "running",
      };

      this.executions.set(execution.id, execution);

      this.executeJobSafely(job, execution).catch(() => {
        // Error already handled in executeJobSafely
      });
    }

    if (enabledJobs.length > 0) {
      this.logger.debug(
        `Emitted event '${eventName}' to ${enabledJobs.length} job(s)`,
      );
    }

    return enabledJobs.length;
  }

  getEventJobNames(): string[] {
    return this.triggerManager.getAllEventNames();
  }

  private async executeJobWrapper(jobId: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (!job || !job.enabled) {
      return;
    }

    const execution: JobExecution = {
      id: crypto.randomUUID(),
      jobId,
      triggeredBy: "schedule",
      startedAt: new Date(),
      status: "running",
    };

    this.executions.set(execution.id, execution);
    await this.executeJobSafely(job, execution);

    // Re-schedule interval jobs after successful execution
    if (job.scheduleType === "interval") {
      this.triggerManager.rescheduleIntervalJob(job, (id) =>
        this.executeJobWrapper(id),
      );
    }
  }

  private async executeJobSafely(
    job: JobDefinition,
    execution: JobExecution,
  ): Promise<void> {
    try {
      if (job.handler) {
        await job.handler(job.id);
      }
      this.finishExecution(execution.id, "completed");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Job '${job.id}' execution failed: ${msg}`);
      this.finishExecution(execution.id, "failed", msg);
    }
  }

  private finishExecution(
    executionId: string,
    status: "completed" | "failed" | "skipped",
    errorMessage?: string,
  ): void {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    const finished: JobExecution = {
      ...execution,
      status,
      finishedAt: new Date(),
      errorMessage,
    };
    this.executions.set(executionId, finished);

    // Keep only last 100 executions to bound memory
    if (this.executions.size > 100) {
      const oldest = Array.from(this.executions.keys())[0];
      if (oldest !== executionId) {
        this.executions.delete(oldest);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }
}

// Re-export for convenience
export type { JobDefinition, ScheduleType } from "./trigger-manager.service";
