import { Injectable, Logger } from '@nestjs/common';
import {
  TenantConnectionManager,
  type Sql,
} from '../../providers/tenant-connection-manager';

export interface ExecutionLog {
  id: string;
  schedule_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  output: string;
  error: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

interface ExecutionQueryParams {
  status?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);

  constructor(private readonly tenantConnections: TenantConnectionManager) {}

  private getSql(tenantId: string): Promise<Sql> {
    return this.tenantConnections.ensureSchema(tenantId);
  }

  async createLog(
    scheduleId: string,
    tenantId: string,
  ): Promise<ExecutionLog> {
    const sql = await this.getSql(tenantId);
    const rows = await sql<ExecutionLog[]>`
      INSERT INTO execution_logs (schedule_id, status)
      VALUES (${scheduleId}, 'pending')
      RETURNING *
    `;
    return rows[0];
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: ExecutionStatus,
    output?: string,
    error?: string,
    metadata?: Record<string, unknown>,
  ): Promise<ExecutionLog> {
    const sql = await this.getSql(tenantId);
    const isTerminal = status === 'completed' || status === 'failed' || status === 'timeout';

    const rows = await sql<ExecutionLog[]>`
      UPDATE execution_logs SET
        status       = ${status},
        output       = COALESCE(${output ?? null}, output),
        error        = COALESCE(${error ?? null}, error),
        metadata     = COALESCE(${metadata ? sql.json(metadata as any) : null}, metadata),
        completed_at = ${isTerminal ? new Date().toISOString() : null},
        duration_ms  = ${isTerminal ? sql`EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000` : sql`NULL`}
      WHERE id = ${id}
      RETURNING *
    `;
    return rows[0];
  }

  async findByScheduleId(
    scheduleId: string,
    params: ExecutionQueryParams,
    tenantId: string,
  ): Promise<{ executions: ExecutionLog[]; limit: number; offset: number }> {
    const sql = await this.getSql(tenantId);
    const { status, limit, offset } = params;

    const rows = await sql<ExecutionLog[]>`
      SELECT * FROM execution_logs
      WHERE schedule_id = ${scheduleId}
        ${status ? sql`AND status = ${status}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    return { executions: rows, limit, offset };
  }

  async findAll(
    params: ExecutionQueryParams,
    tenantId: string,
  ): Promise<{ executions: ExecutionLog[]; limit: number; offset: number }> {
    const sql = await this.getSql(tenantId);
    const { status, limit, offset } = params;

    const rows = await sql<ExecutionLog[]>`
      SELECT * FROM execution_logs
      WHERE 1=1
        ${status ? sql`AND status = ${status}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    return { executions: rows, limit, offset };
  }

  async findById(id: string, tenantId: string): Promise<ExecutionLog | null> {
    const sql = await this.getSql(tenantId);
    const rows = await sql<ExecutionLog[]>`
      SELECT * FROM execution_logs WHERE id = ${id}
    `;
    return rows[0] ?? null;
  }
}
