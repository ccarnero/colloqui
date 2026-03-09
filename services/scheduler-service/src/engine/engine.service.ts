import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { SCHEDULER_TICK_INTERVAL_MS } from '@yoizen/shared';
import { ScheduleQueue, type QueueEntry } from './schedule-queue';
import { SchedulesService, type Schedule } from '../modules/schedules/schedules.service';
import { ExecutionsService } from '../modules/executions/executions.service';
import { TenantConnectionManager } from '../providers/tenant-connection-manager';

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

const TENANT_DISCOVERY_INTERVAL_MS = 60_000;

export interface ExecutionResult {
  status: ExecutionStatus;
  output: string;
  error: string;
  metadata: Record<string, unknown>;
}

export interface ScheduleExecutor {
  execute(schedule: Schedule, tenantId: string): Promise<ExecutionResult>;
}

@Injectable()
export class EngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EngineService.name);
  private readonly queue = new ScheduleQueue();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private executors = new Map<string, ScheduleExecutor>();
  private readonly tenantServiceUrl = process.env.TENANT_SERVICE_URL ?? '';

  constructor(
    private readonly schedulesService: SchedulesService,
    private readonly executionsService: ExecutionsService,
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  registerExecutor(execMode: string, executor: ScheduleExecutor): void {
    this.executors.set(execMode, executor);
  }

  async onModuleInit(): Promise<void> {
    await this.discoverAndLoad();
    this.tickTimer = setInterval(() => this.tick(), SCHEDULER_TICK_INTERVAL_MS);
    this.discoveryTimer = setInterval(() => this.discoverAndLoad(), TENANT_DISCOVERY_INTERVAL_MS);
    this.logger.log('Scheduler engine started');
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.queue.clear();
    this.logger.log('Scheduler engine stopped');
  }

  addToQueue(tenantId: string, schedule: Schedule): void {
    if (!schedule.next_run_at) return;
    this.queue.insert({
      scheduleId: schedule.id,
      tenantId,
      nextRunAt: new Date(schedule.next_run_at).getTime(),
    });
  }

  updateInQueue(tenantId: string, schedule: Schedule): void {
    if (!schedule.enabled || !schedule.next_run_at) {
      this.queue.remove(schedule.id);
      return;
    }
    this.queue.insert({
      scheduleId: schedule.id,
      tenantId,
      nextRunAt: new Date(schedule.next_run_at).getTime(),
    });
  }

  removeFromQueue(scheduleId: string): void {
    this.queue.remove(scheduleId);
  }

  async executeSchedule(tenantId: string, schedule: Schedule): Promise<void> {
    const executor = this.executors.get(schedule.exec_mode);
    if (!executor) {
      this.logger.error(`No executor registered for exec_mode '${schedule.exec_mode}'`);
      return;
    }

    const log = await this.executionsService.createLog(schedule.id, tenantId);
    await this.executionsService.updateStatus(log.id, tenantId, 'running');

    try {
      const result = await executor.execute(schedule, tenantId);
      await this.executionsService.updateStatus(
        log.id,
        tenantId,
        result.status,
        result.output,
        result.error,
        result.metadata,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.executionsService.updateStatus(log.id, tenantId, 'failed', '', message);
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    const due = this.queue.popAllDue(now);
    if (due.length === 0) return;

    const tasks = due.map((entry) => this.processDueEntry(entry));
    await Promise.allSettled(tasks);
  }

  private async processDueEntry(entry: QueueEntry): Promise<void> {
    const { scheduleId, tenantId } = entry;
    try {
      const claimed = await this.schedulesService.claimSchedule(scheduleId, tenantId);
      if (!claimed) return;

      await this.executeSchedule(tenantId, claimed);
      const updated = await this.schedulesService.markExecuted(scheduleId, tenantId);
      if (updated && updated.enabled && updated.next_run_at) {
        this.queue.insert({
          scheduleId: updated.id,
          tenantId,
          nextRunAt: new Date(updated.next_run_at).getTime(),
        });
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
        const schedules = await this.schedulesService.getEnabledSchedules(tenantId);
        for (const s of schedules) {
          if (s.next_run_at && !this.queue.has(s.id)) {
            this.queue.insert({
              scheduleId: s.id,
              tenantId,
              nextRunAt: new Date(s.next_run_at).getTime(),
            });
            loaded++;
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to load schedules for tenant '${tenantId}': ${err}`);
      }
    }

    if (loaded > 0) {
      this.logger.log(`Loaded ${loaded} schedules into queue (total: ${this.queue.size})`);
    }
  }

  private async discoverTenants(): Promise<string[]> {
    if (!this.tenantServiceUrl) {
      return this.tenantConnections.getKnownTenantIds();
    }

    try {
      const response = await fetch(`${this.tenantServiceUrl}/tenants`);
      if (!response.ok) {
        this.logger.warn(`Tenant discovery failed: HTTP ${response.status}`);
        return this.tenantConnections.getKnownTenantIds();
      }
      const data = (await response.json()) as { tenants?: Array<{ name: string }> };
      if (Array.isArray(data.tenants)) {
        return data.tenants.map((t) => t.name);
      }
      return this.tenantConnections.getKnownTenantIds();
    } catch (err) {
      this.logger.warn(`Tenant discovery error: ${err}`);
      return this.tenantConnections.getKnownTenantIds();
    }
  }
}
