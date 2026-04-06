/**
 * Tenant-scoped schedule persistence (`schedules` table per tenant DB).
 */
import { Injectable } from "@nestjs/common";
import { TenantConnectionManager, type Sql } from "../../providers/tenant-connection-manager";
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  type ExecMode,
  type ScheduleType,
} from "./schedules.dto";
import type { IScheduleQueryParams } from "../../types";
import { asPostgresJsonValue } from "../../utils/postgres-json";

export interface ISchedule {
  id: string;
  name: string;
  description: string;
  type: ScheduleType;
  expression: string;
  exec_mode: ExecMode;
  config: Record<string, unknown>;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Options for updating a schedule row. */
export interface IUpdateScheduleOptions {
  id: string;
  tenantId: string;
  dto: UpdateScheduleDto;
  existing: ISchedule;
  nextRunAt: string | null;
}

/** Parameters for persisting a schedule run (last_run, next_run, enabled). */
export interface IMarkExecutedParams {
  readonly id: string;
  readonly tenantId: string;
  readonly nextRunAt: string | null;
  readonly enabled: boolean;
}

@Injectable()
export class SchedulesRepository {
  constructor(private readonly tenantConnections: TenantConnectionManager) {}

  private async getSql(tenantId: string): Promise<Sql> {
    return this.tenantConnections.ensureSchema(tenantId);
  }

  async create(
    dto: CreateScheduleDto,
    tenantId: string,
    nextRunAt: Date | null,
  ): Promise<ISchedule> {
    const sql = await this.getSql(tenantId);
    const rows = await sql<ISchedule[]>`
      INSERT INTO schedules (name, description, type, expression, exec_mode, config, enabled, next_run_at)
      VALUES (
        ${dto.name},
        ${dto.description ?? ""},
        ${dto.type},
        ${dto.expression},
        ${dto.exec_mode},
        ${sql.json(asPostgresJsonValue(dto.config))},
        ${dto.enabled !== false},
        ${nextRunAt?.toISOString() ?? null}
      )
      RETURNING *
    `;
    return rows[0];
  }

  async findAll(
    params: IScheduleQueryParams,
    tenantId: string,
  ): Promise<{ schedules: ISchedule[]; limit: number; offset: number }> {
    const sql = await this.getSql(tenantId);
    const { enabled, type, limit, offset } = params;

    const rows = await sql<ISchedule[]>`
      SELECT * FROM schedules
      WHERE 1=1
        ${enabled !== undefined ? sql`AND enabled = ${enabled === "true"}` : sql``}
        ${type ? sql`AND type = ${type}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    return { schedules: rows, limit, offset };
  }

  async findById(id: string, tenantId: string): Promise<ISchedule | undefined> {
    const sql = await this.getSql(tenantId);
    const rows = await sql<ISchedule[]>`
      SELECT * FROM schedules WHERE id = ${id}
    `;
    return rows[0];
  }

  async updateSchedule(options: IUpdateScheduleOptions): Promise<ISchedule> {
    const { id, tenantId, dto, existing, nextRunAt } = options;
    const sql = await this.getSql(tenantId);
    const newType = dto.type ?? existing.type;
    const newExpression = dto.expression ?? existing.expression;

    const rows = await sql<ISchedule[]>`
      UPDATE schedules SET
        name        = ${dto.name ?? existing.name},
        description = ${dto.description ?? existing.description},
        type        = ${newType},
        expression  = ${newExpression},
        exec_mode   = ${dto.exec_mode ?? existing.exec_mode},
        config      = ${sql.json(asPostgresJsonValue(dto.config ?? existing.config))},
        enabled     = ${dto.enabled ?? existing.enabled},
        next_run_at = ${nextRunAt},
        updated_at  = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    return rows[0];
  }

  async remove(id: string, tenantId: string): Promise<{ deleted: boolean }> {
    const sql = await this.getSql(tenantId);
    const rows = await sql`DELETE FROM schedules WHERE id = ${id} RETURNING id`;
    return { deleted: rows.length > 0 };
  }

  async getEnabledSchedules(tenantId: string): Promise<ISchedule[]> {
    const sql = await this.getSql(tenantId);
    return sql<ISchedule[]>`
      SELECT * FROM schedules
      WHERE enabled = true AND next_run_at IS NOT NULL
      ORDER BY next_run_at ASC
    `;
  }

  async markExecuted(params: IMarkExecutedParams): Promise<ISchedule | null> {
    const { id, tenantId, nextRunAt, enabled } = params;
    const sql = await this.getSql(tenantId);
    const rows = await sql<ISchedule[]>`
      UPDATE schedules SET
        last_run_at = NOW(),
        next_run_at = ${nextRunAt},
        enabled     = ${enabled},
        updated_at  = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    return rows[0] ?? null;
  }

  async claimSchedule(id: string, tenantId: string): Promise<ISchedule | null> {
    const sql = await this.getSql(tenantId);
    const rows = await sql<ISchedule[]>`
      SELECT * FROM schedules
      WHERE id = ${id} AND enabled = true
      FOR UPDATE SKIP LOCKED
    `;
    return rows[0] ?? null;
  }
}
