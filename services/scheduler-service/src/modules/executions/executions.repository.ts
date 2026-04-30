/** Execution log persistence (`execution_logs` per tenant). */
import { Injectable } from "@nestjs/common";
import {
  TenantConnectionManager,
  type Sql,
} from "../../providers/tenant-connection-manager";
import type { ExecutionStatus, IExecutionQueryParams } from "../../types";
import { asPostgresJsonValue } from "../../utils/postgres-json";
export interface IExecutionLog {
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

export interface IUpdateExecutionStatusOptions {
  id: string;
  tenantId: string;
  status: ExecutionStatus;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ExecutionsRepository {
  constructor(private readonly tenantConnections: TenantConnectionManager) {}

  private async getSql(tenantId: string): Promise<Sql> {
    return this.tenantConnections.ensureSchema(tenantId);
  }

  async createLog(
    scheduleId: string,
    tenantId: string,
  ): Promise<IExecutionLog> {
    const sql = await this.getSql(tenantId);
    const rows = await sql<IExecutionLog[]>`
      INSERT INTO execution_logs (schedule_id, status)
      VALUES (${scheduleId}, 'pending')
      RETURNING *
    `;
    return rows[0];
  }

  async updateStatus(
    opts: IUpdateExecutionStatusOptions,
  ): Promise<IExecutionLog> {
    const { id, tenantId, status, output, error, metadata } = opts;
    const sql = await this.getSql(tenantId);
    const isTerminal =
      status === "completed" || status === "failed" || status === "timeout";

    const rows = await sql<IExecutionLog[]>`
      UPDATE execution_logs SET
        status       = ${status},
        output       = COALESCE(${output ?? null}, output),
        error        = COALESCE(${error ?? null}, error),
        metadata     = COALESCE(${metadata ? sql.json(asPostgresJsonValue(metadata)) : null}, metadata),
        completed_at = ${isTerminal ? new Date().toISOString() : null},
        duration_ms  = ${isTerminal ? sql`EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000` : sql`NULL`}
      WHERE id = ${id}
      RETURNING *
    `;
    return rows[0];
  }

  async findByScheduleId(
    scheduleId: string,
    params: IExecutionQueryParams,
    tenantId: string,
  ): Promise<{ executions: IExecutionLog[]; limit: number; offset: number }> {
    const sql = await this.getSql(tenantId);
    const { status, limit, offset } = params;

    const rows = await sql<IExecutionLog[]>`
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
    params: IExecutionQueryParams,
    tenantId: string,
  ): Promise<{ executions: IExecutionLog[]; limit: number; offset: number }> {
    const sql = await this.getSql(tenantId);
    const { status, limit, offset } = params;

    const rows = await sql<IExecutionLog[]>`
      SELECT * FROM execution_logs
      WHERE 1=1
        ${status ? sql`AND status = ${status}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    return { executions: rows, limit, offset };
  }

  async findById(id: string, tenantId: string): Promise<IExecutionLog | null> {
    const sql = await this.getSql(tenantId);
    const rows = await sql<IExecutionLog[]>`
      SELECT * FROM execution_logs WHERE id = ${id}
    `;
    return rows[0] ?? null;
  }
}
