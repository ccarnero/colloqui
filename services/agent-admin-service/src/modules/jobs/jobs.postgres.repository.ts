import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Sql, TenantConnectionManager } from "@yoizen/database";
import type { JsonValue } from "@yoizen/shared";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { TenantScopedPostgresRepository } from "../../providers/tenant-scoped.repository";
import type {
  ICreateJobData,
  IFindAllJobsOptions,
  IJob,
  IJobsRepository,
  IUpdateJobData,
} from "./jobs.repository.interface";
import { calculateNextRun } from "./schedule.utils";

@Injectable()
export class JobsPostgresRepository
  extends TenantScopedPostgresRepository
  implements IJobsRepository
{
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantConnectionManager,
  ) {
    super(connectionManager);
  }

  /**
   * Lists jobs with optional filters and pagination.
   */
  async findAll(
    tenantId: string,
    options: IFindAllJobsOptions = {}
  ): Promise<{ jobs: IJob[]; total: number }> {
    const sql = await this.getSql(tenantId);
    const { agent_id, is_active, limit = 20, offset = 0 } = options;

    // Build conditions as parameterized fragments
    type WhereFragment = ReturnType<typeof sql>;

    const conditions: WhereFragment[] = [];

    if (agent_id) {
      conditions.push(sql`agent_id = ${agent_id}`);
    }

    if (is_active !== undefined) {
      conditions.push(sql`is_active = ${is_active}`);
    }

    // Compose WHERE clause from fragments
    let whereClause: WhereFragment;
    if (conditions.length === 0) {
      whereClause = sql`1=1`;
    } else {
      whereClause = conditions[0];
      for (let i = 1; i < conditions.length; i++) {
        whereClause = sql`${whereClause} AND ${conditions[i]}`;
      }
    }

    const countResult = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count FROM jobs WHERE ${whereClause}
    `;
    const total = Number(countResult[0].count);

    const jobs = await sql<IJob[]>`
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
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return { jobs, total };
  }

  /**
   * Finds a job by ID.
   */
  async findById(tenantId: string, id: string): Promise<IJob | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IJob[]>`
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
      WHERE id = ${id}
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  /**
   * Creates a job and computes next_run.
   */
  async create(tenantId: string, data: ICreateJobData): Promise<IJob> {
    const sql = await this.getSql(tenantId);
    const jobId = randomUUID();

    const nextRun = calculateNextRun(data.schedule);

    const results = await sql<IJob[]>`
      INSERT INTO jobs (
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
      ) VALUES (
        ${jobId},
        ${data.name},
        ${data.agent_id},
        ${data.schedule},
        ${sql.json((data.payload ?? {}) as JsonValue)},
        ${data.is_active ?? true},
        NULL,
        ${nextRun},
        NOW(),
        NOW()
      )
      RETURNING 
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
    `;

    return results[0];
  }

  /**
   * Updates a job; recomputes next_run when the schedule changes.
   */
  async update(
    tenantId: string,
    id: string,
    data: IUpdateJobData
  ): Promise<IJob | null> {
    const sql = await this.getSql(tenantId);

    // Build dynamic SET clause by composing fragments
    type SetFragment = ReturnType<typeof sql>;

    let setClause = sql`updated_at = NOW()`;

    if (data.name !== undefined) {
      setClause = sql`${setClause}, name = ${data.name}`;
    }
    if (data.agent_id !== undefined) {
      setClause = sql`${setClause}, agent_id = ${data.agent_id}`;
    }
    if (data.schedule !== undefined) {
      setClause = sql`${setClause}, schedule = ${data.schedule}`;
      const nextRun = calculateNextRun(data.schedule);
      setClause = sql`${setClause}, next_run = ${nextRun}`;
    }
    if (data.payload !== undefined) {
      setClause = sql`${setClause}, payload = ${sql.json(data.payload as JsonValue)}`;
    }
    if (data.is_active !== undefined) {
      setClause = sql`${setClause}, is_active = ${data.is_active}`;
    }

    const results = await sql<IJob[]>`
      UPDATE jobs
      SET ${setClause}
      WHERE id = ${id}
      RETURNING 
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
    `;

    return results[0] ?? null;
  }

  /**
   * Deletes a job and all of its executions in a single transaction.
   *
   * job_executions.job_id references jobs(id) with no ON DELETE clause
   * (default NO ACTION), so a bare DELETE FROM jobs would raise a
   * foreign_key_violation (23503) whenever the job has recorded executions.
   * Executions are operational history with no meaning once their parent
   * job is gone, so they are cascade-deleted here rather than blocking the
   * delete with a 409.
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = await this.getSql(tenantId);

    return sql.begin(async (_tx) => {
      const tx = _tx as unknown as Sql;

      await tx`
        DELETE FROM job_executions
        WHERE job_id = ${id}
      `;

      const results = await tx<{ id: string }[]>`
        DELETE FROM jobs
        WHERE id = ${id}
        RETURNING id
      `;

      return results.length > 0;
    });
  }

  /**
   * Activates a job.
   */
  async enable(tenantId: string, id: string): Promise<IJob | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IJob[]>`
      UPDATE jobs
      SET 
        is_active = true,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING 
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
    `;

    return results[0] ?? null;
  }

  /**
   * Deactivates a job.
   */
  async disable(tenantId: string, id: string): Promise<IJob | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IJob[]>`
      UPDATE jobs
      SET 
        is_active = false,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING 
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
    `;

    return results[0] ?? null;
  }

  /**
   * Updates last_run and recomputes next_run.
   */
  async updateLastRun(
    tenantId: string,
    id: string,
    schedule: string
  ): Promise<IJob | null> {
    const sql = await this.getSql(tenantId);
    const nextRun = calculateNextRun(schedule);

    const results = await sql<IJob[]>`
      UPDATE jobs
      SET 
        last_run = NOW(),
        next_run = ${nextRun},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING 
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
    `;

    return results[0] ?? null;
  }
}
