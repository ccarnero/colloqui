import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { SCHEDULER_TICK_INTERVAL_MS } from "@yoizen/shared";
import { schedulerServiceConfig } from "../config";
import { ScheduleQueue, type IQueueEntry } from "./schedule-queue";
import {
  SchedulesService,
  type ISchedule,
} from "../modules/schedules/schedules.service";
import { ExecutionsService } from "../modules/executions/executions.service";
import { TenantConnectionManager } from "../providers/tenant-connection-manager";
import type { IScheduleExecutor } from "../executors/executor.interface";
import type { ExecutionStatus } from "../types";

const TENANT_DISCOVERY_INTERVAL_MS = 60_000;

export interface IExecutionResult {
  status: ExecutionStatus;
  output: string;
  error: string;
  metadata: Record<string, unknown>;
}

/**
 * Tick loop + tenant discovery: loads due schedules and dispatches to executors.
 */
@Injectable()
export class EngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(EngineService.name);
  private readonly queue = new ScheduleQueue();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private executors = new Map<string, IScheduleExecutor>();
  private readonly tenantServiceUrl = schedulerServiceConfig.tenantServiceUrl;

  constructor(
    private readonly schedulesService: SchedulesService,
    private readonly executionsService: ExecutionsService,
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  registerExecutor(execMode: string, executor: IScheduleExecutor): void {
    this.executors.set(execMode, executor);
  }

  async onModuleInit(): Promise<void> {
    await this.discoverAndLoad();
    this.tickTimer = setInterval(() => this.tick(), SCHEDULER_TICK_INTERVAL_MS);
    this.discoveryTimer = setInterval(
      () => this.discoverAndLoad(),
      TENANT_DISCOVERY_INTERVAL_MS,
    );
    this.logger.log("Scheduler engine started");
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.queue.clear();
    this.logger.log("Scheduler engine stopped");
  }

  /** Builds a queue entry from a schedule row (callers ensure `next_run_at` is set). */
  private buildQueueEntry(
    tenantId: string,
    scheduleId: string,
    nextRunAtIso: string,
  ): IQueueEntry {
    return {
      scheduleId,
      tenantId,
      nextRunAt: new Date(nextRunAtIso).getTime(),
    };
  }

  addToQueue(tenantId: string, schedule: ISchedule): void {
    if (!schedule.next_run_at) return;
    this.queue.insert(
      this.buildQueueEntry(tenantId, schedule.id, schedule.next_run_at),
    );
  }

  updateInQueue(tenantId: string, schedule: ISchedule): void {
    if (!schedule.enabled || !schedule.next_run_at) {
      this.queue.remove(schedule.id);
      return;
    }
    this.queue.insert(
      this.buildQueueEntry(tenantId, schedule.id, schedule.next_run_at),
    );
  }

  removeFromQueue(scheduleId: string): void {
    this.queue.remove(scheduleId);
  }

  /**
   * Runs a schedule immediately (manual API trigger) and applies the same
   * post-run bookkeeping as the tick path: {@link SchedulesService.markExecuted}
   * and queue refresh.
   */
  async triggerScheduleManually(
    tenantId: string,
    schedule: ISchedule,
  ): Promise<void> {
    await this.executeSchedule(tenantId, schedule);
    const updated = await this.schedulesService.markExecuted(
      schedule.id,
      tenantId,
    );
    if (updated && updated.enabled && updated.next_run_at) {
      this.queue.insert(
        this.buildQueueEntry(tenantId, updated.id, updated.next_run_at),
      );
    }
  }

  async executeSchedule(tenantId: string, schedule: ISchedule): Promise<void> {
    const executor = this.executors.get(schedule.exec_mode);
    if (!executor) {
      this.logger.error(
        `No executor registered for exec_mode '${schedule.exec_mode}'`,
      );
      return;
    }

    const log = await this.executionsService.createLog(schedule.id, tenantId);
    await this.executionsService.updateStatus({
      id: log.id,
      tenantId,
      status: "running",
    });

    try {
      const result = await executor.execute(schedule, tenantId);
      await this.executionsService.updateStatus({
        id: log.id,
        tenantId,
        status: result.status,
        output: result.output,
        error: result.error,
        metadata: result.metadata,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.executionsService.updateStatus({
        id: log.id,
        tenantId,
        status: "failed",
        output: "",
        error: message,
      });
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    const due = this.queue.popAllDue(now);
    if (due.length === 0) return;

    const tasks = due.map((entry) => this.processDueEntry(entry));
    await Promise.allSettled(tasks);
  }

  private async processDueEntry(entry: IQueueEntry): Promise<void> {
    const { scheduleId, tenantId } = entry;
    try {
      const claimed = await this.schedulesService.claimSchedule(
        scheduleId,
        tenantId,
      );
      if (!claimed) return;

      await this.executeSchedule(tenantId, claimed);
      const updated = await this.schedulesService.markExecuted(
        scheduleId,
        tenantId,
      );
      if (updated && updated.enabled && updated.next_run_at) {
        this.queue.insert(
          this.buildQueueEntry(tenantId, updated.id, updated.next_run_at),
        );
      }
    } catch (err) {
      this.logger.error(`Error processing schedule ${scheduleId}: ${err}`);
    }
  }

  private async discoverAndLoad(): Promise<void> {
    const tenantIds = await this.discoverTenants();
    let loaded = 0;

    for (const tenantId of tenantIds) {
      try {
        const schedules =
          await this.schedulesService.getEnabledSchedules(tenantId);
        for (const s of schedules) {
          if (s.next_run_at && !this.queue.has(s.id)) {
            this.queue.insert(
              this.buildQueueEntry(tenantId, s.id, s.next_run_at),
            );
            loaded++;
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed to load schedules for tenant '${tenantId}': ${err}`,
        );
      }
    }

    if (loaded > 0) {
      this.logger.log(
        `Loaded ${loaded} schedules into queue (total: ${this.queue.size})`,
      );
    }
  }

  /**
   * Pulls the current set of tenants the scheduler should iterate over
   * each discovery cycle.
   *
   * Wire format: tenant-service `GET /tenants` returns a **flat array**
   * of `ITenantSummary` objects; an earlier version of this method
   * looked for `{ tenants: [...] }` and silently fell back to
   * {@link TenantConnectionManager.getKnownTenantIds} on every cycle,
   * which kept stale per-tenant pools alive forever once a tenant was
   * destroyed (cron kept polling deleted DBs → DNS / auth errors).
   *
   * Filter strategy:
   *  - Push down `?status=ready` to tenant-service so the platform DB
   *    (the source of truth) does the filtering — O(1) per row at the
   *    server, zero extra rows on the wire.
   *  - Defensive client-side filter for backwards compatibility with
   *    older tenant-service builds that don't honor the query param;
   *    the per-element check is `t.provisioningStatus === 'ready'`,
   *    O(N) over the response which is already linear.
   *
   * Fallback to `getKnownTenantIds()` (which `evictTenant` keeps
   * pruned) is reserved for transport failures only — never for a
   * shape mismatch.
   */
  private async discoverTenants(): Promise<string[]> {
    if (!this.tenantServiceUrl) {
      return this.tenantConnections.getKnownTenantIds();
    }

    try {
      const response = await fetch(
        `${this.tenantServiceUrl}/tenants?status=ready`,
      );
      if (!response.ok) {
        this.logger.warn(`Tenant discovery failed: HTTP ${response.status}`);
        return this.tenantConnections.getKnownTenantIds();
      }
      const data = (await response.json()) as
        | Array<{ name: string; provisioningStatus?: string }>
        | { tenants?: Array<{ name: string; provisioningStatus?: string }> };

      const list = Array.isArray(data)
        ? data
        : Array.isArray((data as { tenants?: unknown }).tenants)
          ? (data as { tenants: Array<{ name: string; provisioningStatus?: string }> })
              .tenants
          : null;
      if (list === null) {
        this.logger.warn(
          "Tenant discovery: unexpected response shape; falling back to known tenants",
        );
        return this.tenantConnections.getKnownTenantIds();
      }

      const len = list.length;
      const out: string[] = new Array(len);
      let n = 0;
      for (let i = 0; i < len; i++) {
        const t = list[i]!;
        if (
          t.provisioningStatus === undefined ||
          t.provisioningStatus === "ready"
        ) {
          out[n++] = t.name;
        }
      }
      out.length = n;
      return out;
    } catch (err) {
      this.logger.warn(`Tenant discovery error: ${err}`);
      return this.tenantConnections.getKnownTenantIds();
    }
  }
}
