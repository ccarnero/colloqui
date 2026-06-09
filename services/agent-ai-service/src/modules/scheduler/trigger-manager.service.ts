import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import CronExpressionParser from "cron-parser";

export type ScheduleType = "cron" | "interval" | "event" | "manual";

export interface JobDefinition {
  readonly id: string;
  readonly scheduleType: ScheduleType;
  readonly scheduleConfig: Record<string, unknown>;
  readonly enabled: boolean;
  readonly handler?: (jobId: string) => Promise<void>;
}

interface ActiveTimer {
  readonly type: "cron" | "interval";
  readonly timerId: ReturnType<typeof setTimeout>;
}

const MISFIRE_GRACE_MS = 30_000;

@Injectable()
export class TriggerManagerService {
  private readonly logger = new PinoLoggerService(TriggerManagerService.name);
  private readonly activeTimers = new Map<string, ActiveTimer>();
  private readonly eventJobs = new Map<string, JobDefinition[]>();

  scheduleJob(job: JobDefinition, wrapper: (jobId: string) => Promise<void>): void {
    if (job.scheduleType === "cron") {
      this.scheduleCronJob(job, wrapper);
    } else if (job.scheduleType === "interval") {
      this.scheduleIntervalJob(job, wrapper);
    } else if (job.scheduleType === "event") {
      this.registerEventJob(job);
    }
    // manual jobs are stored but not scheduled
  }

  private scheduleCronJob(
    job: JobDefinition,
    wrapper: (jobId: string) => Promise<void>,
  ): void {
    const expression = (job.scheduleConfig["expression"] as string) ?? "0 0 * * *";

    try {
      const interval = CronExpressionParser.parse(expression);
      const scheduleNext = (): void => {
        const next = interval.next();
        const delay = next.getTime() - Date.now();

        if (delay > MISFIRE_GRACE_MS) {
          const timerId = setTimeout(async () => {
            this.activeTimers.delete(job.id);
            try {
              await wrapper(job.id);
            } catch (error: unknown) {
              const msg = error instanceof Error ? error.message : String(error);
              this.logger.error(`Cron job '${job.id}' execution failed: ${msg}`);
            }
            scheduleNext();
          }, delay);
          this.activeTimers.set(job.id, { type: "cron", timerId });
        } else {
          this.logger.warn(
            `Cron job '${job.id}' misfire at ${next.toISOString()} — skipping`,
          );
          scheduleNext();
        }
      };

      this.unscheduleJob(job.id);
      scheduleNext();
      this.logger.debug(`Scheduled cron job '${job.id}' with expression '${expression}'`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Invalid cron expression for job '${job.id}': ${msg}`,
      );
    }
  }

  private scheduleIntervalJob(
    job: JobDefinition,
    wrapper: (jobId: string) => Promise<void>,
  ): void {
    const seconds = (job.scheduleConfig["seconds"] as number) ?? 3600;
    const ms = seconds * 1000;

    this.unscheduleJob(job.id);

    const timerId = setTimeout(
      async () => {
        try {
          await wrapper(job.id);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Interval job '${job.id}' execution failed: ${msg}`,
          );
        }
      },
      ms,
    );
    // setInterval would accumulate drift; using recursive setTimeout after
    // execution in the wrapper keeps intervals accurate. For simplicity,
    // we use setTimeout once and the scheduler re-schedules after execution.
    this.activeTimers.set(job.id, { type: "interval", timerId });
    this.logger.debug(
      `Scheduled interval job '${job.id}' with ${seconds}s interval`,
    );
  }

  registerEventJob(job: JobDefinition): void {
    const eventName = (job.scheduleConfig["event_name"] as string) ?? "default";

    if (!this.eventJobs.has(eventName)) {
      this.eventJobs.set(eventName, []);
    }

    const jobs = this.eventJobs.get(eventName)!;
    const filtered = jobs.filter((j) => j.id !== job.id);
    filtered.push(job);
    this.eventJobs.set(eventName, filtered);

    this.logger.debug(
      `Registered event job '${job.id}' for event '${eventName}'`,
    );
  }

  unscheduleJob(jobId: string): void {
    const active = this.activeTimers.get(jobId);
    if (active) {
      clearTimeout(active.timerId);
      this.activeTimers.delete(jobId);
    }

    for (const [eventName, jobs] of this.eventJobs) {
      const filtered = jobs.filter((j) => j.id !== jobId);
      if (filtered.length === 0) {
        this.eventJobs.delete(eventName);
      } else if (filtered.length !== jobs.length) {
        this.eventJobs.set(eventName, filtered);
      }
    }
  }

  getEventJobs(eventName: string): JobDefinition[] {
    return this.eventJobs.get(eventName) ?? [];
  }

  getAllEventNames(): string[] {
    return Array.from(this.eventJobs.keys());
  }

  stopAll(): void {
    for (const [, active] of this.activeTimers) {
      clearTimeout(active.timerId);
    }
    this.activeTimers.clear();
    this.eventJobs.clear();
    this.logger.debug("All triggers stopped");
  }

  /**
   * Re-schedule an interval job after it completes execution.
   * This ensures the next run starts `intervalMs` after the previous one finishes.
   */
  rescheduleIntervalJob(
    job: JobDefinition,
    wrapper: (jobId: string) => Promise<void>,
  ): void {
    const seconds = (job.scheduleConfig["seconds"] as number) ?? 3600;
    const ms = seconds * 1000;

    const timerId = setTimeout(async () => {
      this.activeTimers.delete(job.id);
      try {
        await wrapper(job.id);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Interval job '${job.id}' execution failed: ${msg}`,
        );
      }
      this.rescheduleIntervalJob(job, wrapper);
    }, ms);

    this.activeTimers.set(job.id, { type: "interval", timerId });
  }
}
