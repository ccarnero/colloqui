import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { TenantConnectionManager } from '../../providers/tenant-connection-manager';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  ScheduleType,
  ExecMode,
} from './schedule.dto';
import { CronExpressionParser } from 'cron-parser';

export interface Schedule {
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

interface ScheduleQueryParams {
  enabled?: string;
  type?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(private readonly tenantConnections: TenantConnectionManager) {}

  computeNextRunAt(type: ScheduleType, expression: string): Date | null {
    switch (type) {
      case ScheduleType.CRON: {
        const expr = CronExpressionParser.parse(expression);
        return expr.next().toDate();
      }
      case ScheduleType.INTERVAL: {
        const ms = Number(expression);
        if (!Number.isFinite(ms) || ms <= 0) {
          throw new BadRequestException(
            'Interval expression must be a positive number (milliseconds)',
          );
        }
        return new Date(Date.now() + ms);
      }
      case ScheduleType.ONE_TIME: {
        const date = new Date(expression);
        if (isNaN(date.getTime())) {
          throw new BadRequestException(
            'One-time expression must be a valid ISO 8601 timestamp',
          );
        }
        return date;
      }
    }
  }

  async create(dto: CreateScheduleDto, tenantId: string): Promise<Schedule> {
    this.validateConfig(dto.exec_mode, dto.config);
    const sql = await this.tenantConnections.ensureSchema(tenantId);

    const nextRunAt = this.computeNextRunAt(dto.type, dto.expression);

    const rows = await sql<Schedule[]>`
      INSERT INTO schedules (name, description, type, expression, exec_mode, config, enabled, next_run_at)
      VALUES (
        ${dto.name},
        ${dto.description ?? ''},
        ${dto.type},
        ${dto.expression},
        ${dto.exec_mode},
        ${sql.json(dto.config as any)},
        ${dto.enabled !== false},
        ${nextRunAt?.toISOString() ?? null}
      )
      RETURNING *
    `;
    this.logger.log(`Created schedule '${rows[0].name}' for tenant '${tenantId}'`);
    return rows[0];
  }

  async findAll(params: ScheduleQueryParams, tenantId: string): Promise<{ schedules: Schedule[]; limit: number; offset: number }> {
    const sql = await this.tenantConnections.ensureSchema(tenantId);
    const { enabled, type, limit, offset } = params;

    const rows = await sql<Schedule[]>`
      SELECT * FROM schedules
      WHERE 1=1
        ${enabled !== undefined ? sql`AND enabled = ${enabled === 'true'}` : sql``}
        ${type ? sql`AND type = ${type}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    return { schedules: rows, limit, offset };
  }

  async findById(id: string, tenantId: string): Promise<Schedule> {
    const sql = await this.tenantConnections.ensureSchema(tenantId);

    const rows = await sql<Schedule[]>`
      SELECT * FROM schedules WHERE id = ${id}
    `;
    if (!rows[0]) throw new NotFoundException(`Schedule ${id} not found`);
    return rows[0];
  }

  async update(id: string, dto: UpdateScheduleDto, tenantId: string): Promise<Schedule> {
    const sql = await this.tenantConnections.ensureSchema(tenantId);

    const existing = await this.findById(id, tenantId);
    if (dto.exec_mode || dto.config) {
      this.validateConfig(dto.exec_mode ?? existing.exec_mode, dto.config ?? existing.config);
    }

    const newType = dto.type ?? existing.type;
    const newExpression = dto.expression ?? existing.expression;
    let nextRunAt = existing.next_run_at;

    if (dto.type || dto.expression || dto.enabled !== undefined) {
      const shouldBeEnabled = dto.enabled ?? existing.enabled;
      nextRunAt = shouldBeEnabled ? this.computeNextRunAt(newType, newExpression)?.toISOString() ?? null : null;
    }

    const rows = await sql<Schedule[]>`
      UPDATE schedules SET
        name        = ${dto.name ?? existing.name},
        description = ${dto.description ?? existing.description},
        type        = ${newType},
        expression  = ${newExpression},
        exec_mode   = ${dto.exec_mode ?? existing.exec_mode},
        config      = ${sql.json((dto.config ?? existing.config) as any)},
        enabled     = ${dto.enabled ?? existing.enabled},
        next_run_at = ${nextRunAt},
        updated_at  = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!rows[0]) throw new NotFoundException(`Schedule ${id} not found`);
    return rows[0];
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const sql = await this.tenantConnections.ensureSchema(tenantId);

    const rows = await sql`DELETE FROM schedules WHERE id = ${id} RETURNING id`;
    if (!rows.length) throw new NotFoundException(`Schedule ${id} not found`);
  }

  async getEnabledSchedules(tenantId: string): Promise<Schedule[]> {
    const sql = await this.tenantConnections.ensureSchema(tenantId);

    return sql<Schedule[]>`
      SELECT * FROM schedules
      WHERE enabled = true AND next_run_at IS NOT NULL
      ORDER BY next_run_at ASC
    `;
  }

  async markExecuted(id: string, tenantId: string): Promise<Schedule | null> {
    const sql = await this.tenantConnections.ensureSchema(tenantId);
    const existing = await this.findById(id, tenantId);
    if (!existing) return null;

    let nextRunAt: Date | null = null;
    let enabled = existing.enabled;

    if (existing.type === ScheduleType.ONE_TIME) {
      enabled = false;
    } else {
      nextRunAt = this.computeNextRunAt(existing.type, existing.expression);
    }

    const rows = await sql<Schedule[]>`
      UPDATE schedules SET
        last_run_at = NOW(),
        next_run_at = ${nextRunAt?.toISOString() ?? null},
        enabled     = ${enabled},
        updated_at  = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    return rows[0] ?? null;
  }

  async claimSchedule(id: string, tenantId: string): Promise<Schedule | null> {
    const sql = await this.tenantConnections.ensureSchema(tenantId);

    const rows = await sql<Schedule[]>`
      SELECT * FROM schedules
      WHERE id = ${id} AND enabled = true
      FOR UPDATE SKIP LOCKED
    `;
    return rows[0] ?? null;
  }

  private validateConfig(execMode: ExecMode | string, config: Record<string, unknown>): void {
    if (execMode === ExecMode.JS_INLINE || execMode === ExecMode.JS_K8S) {
      if (!config.script || typeof config.script !== 'string') {
        throw new BadRequestException(
          `exec_mode '${execMode}' requires config.script (string)`,
        );
      }
    }
    if (execMode === ExecMode.DOCKER) {
      if (!config.image || typeof config.image !== 'string') {
        throw new BadRequestException(
          "exec_mode 'docker' requires config.image (string)",
        );
      }
    }
  }
}
