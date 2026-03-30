import { Injectable } from '@nestjs/common';
import { TenantConnectionManager, type Sql } from '../../providers/tenant-connection-manager';

export interface JobExecution {
  id: string;
  job_id: string;
  job_name?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
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

export interface CreateExecutionData {
  job_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  event_payload?: Record<string, unknown>;
  triggered_by?: string;
}

export interface UpdateExecutionData {
  status?: 'pending' | 'running' | 'completed' | 'failed';
  result?: Record<string, unknown>;
  logs?: string[];
  error_message?: string;
  retry_count?: number;
  started_at?: Date;
  finished_at?: Date;
}

export interface FindAllExecutionsOptions {
  job_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any;

@Injectable()
export class JobExecutionsRepository {
  constructor(
    private readonly connectionManager: TenantConnectionManager,
  ) {}

  private getSql(tenantId: string): Sql {
    return this.connectionManager.getConnection(tenantId);
  }

  /**
   * Lista todas las ejecuciones con join opcional a jobs.
   */
  async findAll(
    tenantId: string,
    options: FindAllExecutionsOptions = {},
  ): Promise<{ executions: JobExecution[]; total: number }> {
    const sql = this.getSql(tenantId);
    const { job_id, status, limit = 20, offset = 0 } = options;

    // Build conditions as parameterized fragments
    const conditions: string[] = [];

    if (job_id) {
      conditions.push(sql`e.job_id = ${job_id}` as unknown as string);
    }

    if (status) {
      conditions.push(sql`e.status = ${status}` as unknown as string);
    }

    const whereClause = conditions.length > 0
      ? conditions.join(' AND ')
      : '1=1';

    const countResult = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count 
      FROM job_executions e 
      WHERE ${sql.unsafe(whereClause)}
    `;
    const total = Number(countResult[0].count);

    const executions = await sql<JobExecution[]>`
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
   * Busca una ejecución por su ID.
   */
  async findById(tenantId: string, id: string): Promise<JobExecution | null> {
    const sql = this.getSql(tenantId);

    const results = await sql<JobExecution[]>`
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
      WHERE e.id = ${id}
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  /**
   * Crea una nueva ejecución de job.
   */
  async create(
    tenantId: string,
    data: CreateExecutionData,
  ): Promise<JobExecution> {
    const sql = this.getSql(tenantId);

    const results = await sql<JobExecution[]>`
      INSERT INTO job_executions (
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
        ${data.job_id},
        ${data.status},
        ${sql.json((data.event_payload ?? {}) as JsonValue)},
        NULL,
        ARRAY[]::TEXT[],
        NULL,
        0,
        ${data.triggered_by ?? 'manual'},
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

  /**
   * Actualiza una ejecución existente.
   */
  async update(
    tenantId: string,
    id: string,
    data: UpdateExecutionData,
  ): Promise<JobExecution | null> {
    const sql = this.getSql(tenantId);

    // Build dynamic SET clauses using parameterized fragments
    const setClauses: string[] = [];
    
    if (data.status !== undefined) {
      setClauses.push(sql`status = ${data.status}` as unknown as string);
      if (data.status === 'running') {
        setClauses.push(`started_at = COALESCE(started_at, NOW())`);
      }
      if (data.status === 'completed' || data.status === 'failed') {
        setClauses.push(`finished_at = NOW()`);
      }
    }
    if (data.result !== undefined) {
      setClauses.push(sql`result = ${sql.json(data.result as JsonValue)}` as unknown as string);
    }
    if (data.logs !== undefined) {
      setClauses.push(sql`logs = ${data.logs}` as unknown as string);
    }
    if (data.error_message !== undefined) {
      setClauses.push(sql`error_message = ${data.error_message}` as unknown as string);
    }
    if (data.retry_count !== undefined) {
      setClauses.push(sql`retry_count = ${data.retry_count}` as unknown as string);
    }
    if (data.started_at !== undefined) {
      setClauses.push(sql`started_at = ${data.started_at}` as unknown as string);
    }
    if (data.finished_at !== undefined) {
      setClauses.push(sql`finished_at = ${data.finished_at}` as unknown as string);
    }

    if (setClauses.length === 0) {
      return this.findById(tenantId, id);
    }

    const setClause = setClauses.join(', ');

    const results = await sql<JobExecution[]>`
      UPDATE job_executions
      SET ${sql.unsafe(setClause)}
      WHERE id = ${id}
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

    return results[0] ?? null;
  }

  /**
   * Elimina una ejecución.
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = this.getSql(tenantId);

    const results = await sql<{ id: string }[]>`
      DELETE FROM job_executions
      WHERE id = ${id}
      RETURNING id
    `;

    return results.length > 0;
  }

  /**
   * Lista ejecuciones por job_id.
   */
  async findByJobId(
    tenantId: string,
    jobId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ executions: JobExecution[]; total: number }> {
    return this.findAll(tenantId, { job_id: jobId, limit, offset });
  }
}
