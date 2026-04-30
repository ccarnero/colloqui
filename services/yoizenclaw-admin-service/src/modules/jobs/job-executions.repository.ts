import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { JsonValue } from "@yoizen/shared";
import { joinDynamicWhereFragments } from "../../common/repository-sql.util";
import { TenantScopedRepository } from "../../providers/tenant-scoped.repository";
import { TenantConnectionManager } from "@yoizen/database";

export interface IJobExecution {
  id: string;
  job_id: string;
  job_name?: string;
  status: "pending" | "running" | "completed" | "failed";
  event_payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  logs: string[];
  error_message: string | null;
  retry_count: number;
  triggered_by: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

export interface ICreateExecutionData {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  event_payload?: Record<string, unknown>;
  triggered_by?: string;
}

export interface IFindAllExecutionsOptions {
  job_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class JobExecutionsRepository extends TenantScopedRepository {
  constructor(connectionManager: TenantConnectionManager) {
    super(connectionManager);
  }

  /**
   * Lists executions with an optional join to jobs.
   */
  async findAll(
    tenantId: string,
    options: IFindAllExecutionsOptions = {},
  ): Promise<{ executions: IJobExecution[]; total: number }> {
    const sql = await this.getSql(tenantId);
    const { job_id, status, limit = 20, offset = 0 } = options;

    // Build conditions as parameterized fragments
    const conditions: string[] = [];

    if (job_id) {
      conditions.push(sql`e.job_id = ${job_id}` as unknown as string);
    }

    if (status) {
      conditions.push(sql`e.status = ${status}` as unknown as string);
    }

    const whereClause = joinDynamicWhereFragments(conditions);

    const countResult = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count 
      FROM job_executions e 
      WHERE ${sql.unsafe(whereClause)}
    `;
    const total = Number(countResult[0].count);

    const executions = await sql<IJobExecution[]>`
      SELECT 
        e.id,
        e.job_id,
        j.name as job_name,
        e.status,
        e.event_payload,
        e.result,
        e.logs,
        e.error_message,
        e.retry_count,
        e.triggered_by,
        e.started_at,
        e.finished_at,
        e.created_at
      FROM job_executions e
      LEFT JOIN jobs j ON e.job_id = j.id
      WHERE ${sql.unsafe(whereClause)}
      ORDER BY e.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return { executions, total };
  }

  /**
   * Creates a new job execution.
   */
  async create(
    tenantId: string,
    data: ICreateExecutionData,
  ): Promise<IJobExecution> {
    const sql = await this.getSql(tenantId);
    const executionId = randomUUID();

    const results = await sql<IJobExecution[]>`
      INSERT INTO job_executions (
        id,
        job_id,
        status,
        event_payload,
        result,
        logs,
        error_message,
        retry_count,
        triggered_by,
        started_at,
        finished_at,
        created_at
      ) VALUES (
        ${executionId},
        ${data.job_id},
        ${data.status},
        ${sql.json((data.event_payload ?? {}) as JsonValue)},
        NULL,
        ARRAY[]::TEXT[],
        NULL,
        0,
        ${data.triggered_by ?? "manual"},
        CASE WHEN ${data.status} = 'running' THEN NOW() ELSE NULL END,
        NULL,
        NOW()
      )
      RETURNING 
        id,
        job_id,
        NULL::TEXT as job_name,
        status,
        event_payload,
        result,
        logs,
        error_message,
        retry_count,
        triggered_by,
        started_at,
        finished_at,
        created_at
    `;

    return results[0];
  }
}
