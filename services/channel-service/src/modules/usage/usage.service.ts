import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type {
  IUsageBucketRow,
  IUsageSummaryByChannelEntry,
  IUsageSummaryResponse,
  IUsageTotalsRow,
  UsageBucket,
  UsageQueryDto,
  UsageTotalsQueryDto,
} from "./usage.dto";
import {
  type IUsageRepository,
  type IUsageSummaryChannelRow,
  USAGE_REPOSITORY,
} from "./usage.repository.interface";

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
    dto: UsageQueryDto
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
    dto: UsageTotalsQueryDto
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

  async getUsageSummary(tenantId: string): Promise<IUsageSummaryResponse> {
    const rows = await this.repository.getSummary(tenantId);
    return pivotSummaryRows(rows);
  }

  private parseRange(fromIso: string, toIso: string): { from: Date; to: Date } {
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
        "Date range exceeds 90 days — narrow your filter or use daily buckets"
      );
    }
    return { from, to };
  }
}

/**
 * Pivots flat (channel, direction, events) rows into the summary shape:
 * total counts per direction + per-channel breakdown map.
 */
function pivotSummaryRows(
  rows: readonly IUsageSummaryChannelRow[]
): IUsageSummaryResponse {
  let totalIngress = 0;
  let totalEgress = 0;
  let totalDlq = 0;

  const channelMap = new Map<
    string,
    { ingress: number; egress: number; dlq: number }
  >();

  for (const row of rows) {
    const entry = channelMap.get(row.channel) ?? {
      ingress: 0,
      egress: 0,
      dlq: 0,
    };
    entry[row.direction] += row.events;
    channelMap.set(row.channel, entry);

    if (row.direction === "ingress") {
      totalIngress += row.events;
    } else if (row.direction === "egress") {
      totalEgress += row.events;
    } else {
      totalDlq += row.events;
    }
  }

  const byChannel: IUsageSummaryByChannelEntry[] = [];
  for (const [channel, counts] of channelMap) {
    byChannel.push({ channel, ...counts });
  }
  byChannel.sort((a, b) => a.channel.localeCompare(b.channel));

  return {
    windowHours: 24,
    total: { ingress: totalIngress, egress: totalEgress, dlq: totalDlq },
    byChannel,
  };
}
