import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { SchedulerTenantConnectionManager } from "../../providers/tenant-connection.manager";
import type { JobDefinition } from "../../abstractions/job-definition.interface";

interface TenantJobRow {
  id: string;
  name: string;
  agent_id: string;
  schedule: string;
  payload: Record<string, unknown>;
  is_active: boolean;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class JobReaderService {
  private readonly logger = new PinoLoggerService(JobReaderService.name);

  constructor(
    private readonly tenantManager: SchedulerTenantConnectionManager,
  ) {}

  async readAllTenantJobs(): Promise<Map<string, JobDefinition[]>> {
    const result = new Map<string, JobDefinition[]>();
    const tenantIds = this.tenantManager.getKnownTenantIds();

    if (tenantIds.length === 0) {
      this.logger.log("No tenants known yet — skipping job read");
      return result;
    }

    const reads = tenantIds.map(async (tenantId) => {
      try {
        const jobs = await this.readTenantJobs(tenantId);
        return { tenantId, jobs };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to read jobs for tenant '${tenantId}': ${msg}`,
        );
        return { tenantId, jobs: [] as JobDefinition[] };
      }
    });

    const settled = await Promise.allSettled(reads);

    for (const entry of settled) {
      if (entry.status === "fulfilled") {
        if (entry.value.jobs.length > 0) {
          result.set(entry.value.tenantId, entry.value.jobs);
        }
      }
    }

    this.logger.log(
      `Read jobs from ${tenantIds.length} tenants, ${result.size} have active jobs`,
    );

    return result;
  }

  private async readTenantJobs(tenantId: string): Promise<JobDefinition[]> {
    const sql = this.tenantManager.getConnection(tenantId);

    const rows = await sql<TenantJobRow[]>`
      SELECT
        id,
        name,
        agent_id,
        schedule,
        payload,
        is_active,
        last_run,
        next_run,
        created_at,
        updated_at
      FROM jobs
      WHERE is_active = true
        AND schedule IS NOT NULL
        AND schedule != ''
    `;

    return rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      agent_id: String(row.agent_id),
      schedule: row.schedule,
      schedule_type: this.resolveScheduleType(row.schedule) as
        | "cron"
        | "interval",
      payload: (row.payload as Record<string, unknown>) ?? {},
      is_active: row.is_active,
      last_run: row.last_run,
      next_run: row.next_run,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private resolveScheduleType(schedule: string): "cron" | "interval" {
    if (/^\d+$/.test(schedule)) {
      return "interval";
    }
    return "cron";
  }
}
