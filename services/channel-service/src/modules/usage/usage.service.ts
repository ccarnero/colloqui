import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  USAGE_REPOSITORY,
  type IUsageRepository,
} from "./usage.repository.interface";
import type {
  IUsageBucketRow,
  IUsageTotalsRow,
  UsageBucket,
  UsageQueryDto,
  UsageTotalsQueryDto,
} from "./usage.dto";

/**
 * Cap on the date-range width to protect the continuous-aggregate
 * scans. 90 days of hourly buckets returns at most ~2k rows per
 * (account, channel, direction) key — well within memory + network
 * budgets without requiring server-side pagination.
 */
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1_000;

@Injectable()
export class UsageService {
  constructor(
    @Inject(USAGE_REPOSITORY)
    private readonly repository: IUsageRepository,
  ) {}

  async getUsage(
    tenantId: string,
    dto: UsageQueryDto,
  ): Promise<readonly IUsageBucketRow[]> {
    const { from, to } = this.parseRange(dto.from, dto.to);
    const bucket: UsageBucket = dto.bucket ?? "hour";
    return this.repository.getBuckets({
      tenantId,
      from,
      to,
      bucket,
      ...(dto.accountId !== undefined && { accountId: dto.accountId }),
      ...(dto.channel !== undefined && { channel: dto.channel }),
      ...(dto.direction !== undefined && { direction: dto.direction }),
    });
  }

  async getUsageTotals(
    tenantId: string,
    dto: UsageTotalsQueryDto,
  ): Promise<readonly IUsageTotalsRow[]> {
    const { from, to } = this.parseRange(dto.from, dto.to);
    return this.repository.getTotals({
      tenantId,
      from,
      to,
      ...(dto.accountId !== undefined && { accountId: dto.accountId }),
      ...(dto.channel !== undefined && { channel: dto.channel }),
    });
  }

  private parseRange(
    fromIso: string,
    toIso: string,
  ): { from: Date; to: Date } {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException("Invalid ISO-8601 date range");
    }
    if (from >= to) {
      throw new BadRequestException("'from' must be strictly before 'to'");
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException(
        "Date range exceeds 90 days — narrow your filter or use daily buckets",
      );
    }
    return { from, to };
  }
}
