import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  ScheduleType,
  ExecMode,
} from "./schedules.dto";
import { CronExpressionParser } from "cron-parser";
import { SchedulesRepository, type ISchedule } from "./schedules.repository";
import type { IScheduleQueryParams } from "../../types";

export type { ISchedule };

@Injectable()
export class SchedulesService {
  private readonly logger = new PinoLoggerService(SchedulesService.name);

  constructor(private readonly schedulesRepository: SchedulesRepository) {}

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
            "Interval expression must be a positive number (milliseconds)",
          );
        }
        return new Date(Date.now() + ms);
      }
      case ScheduleType.ONE_TIME: {
        const date = new Date(expression);
        if (isNaN(date.getTime())) {
          throw new BadRequestException(
            "One-time expression must be a valid ISO 8601 timestamp",
          );
        }
        return date;
      }
    }
  }

  async create(dto: CreateScheduleDto, tenantId: string): Promise<ISchedule> {
    this.validateConfig(
      dto.exec_mode,
      dto.config as unknown as Record<string, unknown>,
    );
    const nextRunAt = this.computeNextRunAt(dto.type, dto.expression);

    const row = await this.schedulesRepository.create(dto, tenantId, nextRunAt);
    this.logger.log(
      `Created schedule '${row.name}' for tenant '${tenantId}'`,
    );
    return row;
  }

  async findAll(
    params: IScheduleQueryParams,
    tenantId: string,
  ): Promise<{ schedules: ISchedule[]; limit: number; offset: number }> {
    return this.schedulesRepository.findAll(params, tenantId);
  }

  async findById(id: string, tenantId: string): Promise<ISchedule> {
    const row = await this.schedulesRepository.findById(id, tenantId);
    if (!row) throw new NotFoundException(`Schedule ${id} not found`);
    return row;
  }

  async update(
    id: string,
    dto: UpdateScheduleDto,
    tenantId: string,
  ): Promise<ISchedule> {
    const existing = await this.findById(id, tenantId);
    if (dto.exec_mode || dto.config) {
      this.validateConfig(
        dto.exec_mode ?? existing.exec_mode,
        (dto.config ?? existing.config) as Record<string, unknown>,
      );
    }

    const newType = dto.type ?? existing.type;
    const newExpression = dto.expression ?? existing.expression;
    let nextRunAt = existing.next_run_at;

    if (dto.type || dto.expression || dto.enabled !== undefined) {
      const shouldBeEnabled = dto.enabled ?? existing.enabled;
      nextRunAt = shouldBeEnabled
        ? (this.computeNextRunAt(newType, newExpression)?.toISOString() ?? null)
        : null;
    }

    const row = await this.schedulesRepository.updateSchedule({
      id,
      tenantId,
      dto,
      existing,
      nextRunAt,
    });
    if (!row) throw new NotFoundException(`Schedule ${id} not found`);
    return row;
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const { deleted } = await this.schedulesRepository.remove(id, tenantId);
    if (!deleted) throw new NotFoundException(`Schedule ${id} not found`);
  }

  async getEnabledSchedules(tenantId: string): Promise<ISchedule[]> {
    return this.schedulesRepository.getEnabledSchedules(tenantId);
  }

  async markExecuted(id: string, tenantId: string): Promise<ISchedule | null> {
    const existing = await this.findById(id, tenantId);

    let nextRunAt: Date | null = null;
    let enabled = existing.enabled;

    if (existing.type === ScheduleType.ONE_TIME) {
      enabled = false;
    } else {
      nextRunAt = this.computeNextRunAt(existing.type, existing.expression);
    }

    return this.schedulesRepository.markExecuted({
      id,
      tenantId,
      nextRunAt: nextRunAt?.toISOString() ?? null,
      enabled,
    });
  }

  async claimSchedule(id: string, tenantId: string): Promise<ISchedule | null> {
    return this.schedulesRepository.claimSchedule(id, tenantId);
  }

  private validateConfig(
    execMode: ExecMode | string,
    config: Record<string, unknown>,
  ): void {
    if (execMode === ExecMode.JS_INLINE || execMode === ExecMode.JS_K8S) {
      if (!config.script || typeof config.script !== "string") {
        throw new BadRequestException(
          `exec_mode '${execMode}' requires config.script (string)`,
        );
      }
    }
    if (execMode === ExecMode.DOCKER) {
      if (!config.image || typeof config.image !== "string") {
        throw new BadRequestException(
          "exec_mode 'docker' requires config.image (string)",
        );
      }
    }
  }
}
