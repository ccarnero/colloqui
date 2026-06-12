import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { parseSchedule } from "@yoizen/shared";
import { SchedulerTenantConnectionManager } from "../../providers/tenant-connection.manager";
import { JobReaderService } from "./job-reader.service";
import { JobTriggerService } from "./job-trigger.service";
import { LeaderElectionService } from "./leader-election.service";
import { ExecutionHistoryService } from "./execution-history.service";
import type { JobDefinition } from "../../abstractions/job-definition.interface";
import { agentSchedulerServiceConfig } from "../../config";
import {
  ToadScheduler,
  CronJob,
  SimpleIntervalJob,
  AsyncTask,
} from "toad-scheduler";

interface ActiveSchedule {
  type: "cron" | "interval";
  schedule: string;
}

@Injectable()
export class SchedulerService implements OnModuleDestroy {
  private readonly logger = new PinoLoggerService(SchedulerService.name);
  private readonly scheduler = new ToadScheduler();
  private readonly activeSchedules = new Map<string, Map<string, ActiveSchedule>>();
  private reconcileInterval: ReturnType<typeof setInterval> | null = null;
  private leaderRetryInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly tenantManager: SchedulerTenantConnectionManager,
    private readonly jobReader: JobReaderService,
    private readonly jobTrigger: JobTriggerService,
    private readonly leaderElection: LeaderElectionService,
    private readonly executionHistory: ExecutionHistoryService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }
    if (this.leaderRetryInterval) {
      clearInterval(this.leaderRetryInterval);
      this.leaderRetryInterval = null;
    }
    this.scheduler.stop();
    this.logger.log("Scheduler stopped");
  }

  async start(): Promise<void> {
    const leaderPgUrl = agentSchedulerServiceConfig.leaderElectionPostgresUrl;

    if (!leaderPgUrl) {
      const knownTenants = this.tenantManager.getKnownTenantIds();
      if (knownTenants.length === 0) {
        this.logger.warn(
          "No LEADER_ELECTION_POSTGRES_URL configured and no tenants registered — deferring leader election",
        );
        this.startLeaderRetryLoop();
        return;
      }
    }

    const acquired = await this.leaderElection.tryAcquireLeadership(leaderPgUrl);

    if (!acquired) {
      this.logger.warn("Not the leader — will retry in 10 seconds");
      this.startLeaderRetryLoop();
      return;
    }

    await this.startScheduler();
  }

  private startLeaderRetryLoop(): void {
    if (this.leaderRetryInterval) return;

    this.leaderRetryInterval = setInterval(async () => {
      const leaderPgUrl = agentSchedulerServiceConfig.leaderElectionPostgresUrl;
      if (!leaderPgUrl && this.tenantManager.getKnownTenantIds().length === 0) {
        return;
      }

      const acquired = await this.leaderElection.tryAcquireLeadership(leaderPgUrl);
      if (acquired) {
        if (this.leaderRetryInterval) {
          clearInterval(this.leaderRetryInterval);
          this.leaderRetryInterval = null;
        }
        await this.startScheduler();
      }
    }, 10_000);
  }

  private async startScheduler(): Promise<void> {
    this.logger.log("Starting scheduler service...");

    await this.reconcileAllTenants();

    this.reconcileInterval = setInterval(
      () => this.reconcileAllTenants(),
      agentSchedulerServiceConfig.reconcileIntervalMs,
    );

    this.logger.log(
      `Scheduler started with ${agentSchedulerServiceConfig.reconcileIntervalMs}ms reconcile interval`,
    );
  }

  async reconcileAllTenants(): Promise<void> {
    if (!this.leaderElection.isCurrentlyLeader()) {
      return;
    }

    this.logger.debug("Starting tenant job reconciliation...");

    try {
      const tenantJobs = await this.jobReader.readAllTenantJobs();

      let added = 0;
      let updated = 0;
      let removed = 0;

      const currentTenants = new Set(tenantJobs.keys());
      const knownTenants = new Set(this.activeSchedules.keys());

      for (const tenantId of knownTenants) {
        if (!currentTenants.has(tenantId)) {
          this.removeAllTenantJobs(tenantId);
          removed++;
        }
      }

      for (const [tenantId, jobs] of tenantJobs) {
        const diff = this.reconcileTenant(tenantId, jobs);
        added += diff.added;
        updated += diff.updated;
        removed += diff.removed;
      }

      const totalActive = Array.from(this.activeSchedules.values()).reduce(
        (sum, map) => sum + map.size,
        0,
      );

      this.logger.log(
        `Reconciliation complete: ${added} added, ${updated} updated, ${removed} removed, ${totalActive} total active`,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Reconciliation failed: ${msg}`);
    }
  }

  private reconcileTenant(
    tenantId: string,
    jobs: JobDefinition[],
  ): { added: number; updated: number; removed: number } {
    let added = 0;
    let updated = 0;
    let removed = 0;

    const newJobIds = new Set(jobs.map((j) => j.id));
    let tenantMap = this.activeSchedules.get(tenantId);

    if (!tenantMap) {
      tenantMap = new Map();
      this.activeSchedules.set(tenantId, tenantMap);
    }

    for (const [existingJobId, schedule] of tenantMap) {
      if (!newJobIds.has(existingJobId)) {
        this.removeSchedule(tenantId, existingJobId, schedule);
        tenantMap.delete(existingJobId);
        removed++;
      }
    }

    for (const job of jobs) {
      const existing = tenantMap.get(job.id);
      if (existing) {
        if (existing.schedule === job.schedule) continue;
        this.removeSchedule(tenantId, job.id, existing);
        this.addSchedule(tenantId, job);
        tenantMap.set(job.id, this.createActiveSchedule(job));
        updated++;
      } else {
        this.addSchedule(tenantId, job);
        tenantMap.set(job.id, this.createActiveSchedule(job));
        added++;
      }
    }

    if (tenantMap.size === 0) {
      this.activeSchedules.delete(tenantId);
    }

    return { added, updated, removed };
  }

  private addSchedule(tenantId: string, job: JobDefinition): void {
    const jobId = `${tenantId}:${job.id}`;

    try {
      const handler = async () => {
        await this.executeJob(tenantId, job);
      };

      const asyncTask = new AsyncTask(jobId, handler);

      if (job.schedule_type === "interval") {
        const parsed = parseSchedule(job.schedule);
        if (parsed.kind !== "interval") {
          this.logger.error(
            `Job '${job.id}' (tenant '${tenantId}') has schedule_type=interval but schedule "${job.schedule}" did not parse as a valid interval (kind=${parsed.kind}) — skipping`,
          );
          return;
        }
        const task = new SimpleIntervalJob({ milliseconds: parsed.intervalMs }, asyncTask, {
          id: jobId,
        });
        this.scheduler.addSimpleIntervalJob(task);
      } else {
        const task = new CronJob({ cronExpression: job.schedule }, asyncTask, {
          id: jobId,
        });
        this.scheduler.addCronJob(task);
      }

      this.logger.debug(
        `Scheduled ${job.schedule_type} job '${job.name}' (${job.id}) for tenant '${tenantId}'`,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to schedule job '${job.id}' (tenant '${tenantId}'): ${msg} — skipping`,
      );
    }
  }

  private removeSchedule(
    tenantId: string,
    jobId: string,
    schedule: ActiveSchedule,
  ): void {
    const compositeId = `${tenantId}:${jobId}`;
    try {
      if (schedule.type === "interval") {
        this.scheduler.removeById(compositeId);
      } else {
        this.scheduler.removeById(compositeId);
      }
    } catch {
      // job may have already been removed
    }
  }

  private removeAllTenantJobs(tenantId: string): void {
    const tenantMap = this.activeSchedules.get(tenantId);
    if (!tenantMap) return;

    for (const [jobId, schedule] of tenantMap) {
      this.removeSchedule(tenantId, jobId, schedule);
    }
    this.activeSchedules.delete(tenantId);
  }

  private createActiveSchedule(job: JobDefinition): ActiveSchedule {
    return {
      type: job.schedule_type as "cron" | "interval",
      schedule: job.schedule,
    };
  }

  private async executeJob(
    tenantId: string,
    job: JobDefinition,
  ): Promise<void> {
    const triggeredAt = new Date().toISOString();

    this.logger.log(
      `Executing job '${job.name}' (${job.id}) for tenant '${tenantId}'`,
    );

    try {
      const executionId = await this.jobTrigger.publishTrigger(
        tenantId,
        job.id,
        job.payload,
      );

      await this.executionHistory.recordExecution({
        tenantId,
        jobId: job.id,
        executionId,
        triggeredAt,
        status: "published",
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Job execution failed for '${job.id}' tenant '${tenantId}': ${msg}`,
      );

      await this.executionHistory.recordExecution({
        tenantId,
        jobId: job.id,
        executionId: "",
        triggeredAt,
        status: "failed",
      });
    }
  }

  getActiveScheduleCount(): number {
    return Array.from(this.activeSchedules.values()).reduce(
      (sum, map) => sum + map.size,
      0,
    );
  }

  getActiveSchedulesSummary(): Array<{
    tenantId: string;
    jobCount: number;
  }> {
    return Array.from(this.activeSchedules.entries()).map(
      ([tenantId, map]) => ({
        tenantId,
        jobCount: map.size,
      }),
    );
  }
}
