import { IsEnum, IsISO8601, IsOptional, IsString } from "class-validator";

/**
 * Bucket granularity requested by the dashboard. Maps 1:1 to the
 * TimescaleDB continuous aggregate that backs the response:
 *   - `hour` → `channel_events_hourly`
 *   - `day`  → `channel_events_daily`
 */
export type UsageBucket = "hour" | "day";

export class UsageQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;

  @IsOptional()
  @IsEnum(["hour", "day"] as const)
  bucket?: UsageBucket;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  direction?: "ingress" | "egress" | "dlq";
}

export class UsageTotalsQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  channel?: string;
}

export interface IUsageBucketRow {
  readonly bucket: string;
  readonly accountId: string;
  readonly channel: string;
  readonly direction: "ingress" | "egress" | "dlq";
  readonly events: number;
}

export interface IUsageTotalsRow {
  readonly direction: "ingress" | "egress" | "dlq";
  readonly events: number;
  readonly firstTs: string | null;
  readonly lastTs: string | null;
}

export interface IUsageSummaryByChannelEntry {
  readonly channel: string;
  readonly ingress: number;
  readonly egress: number;
  readonly dlq: number;
}

export interface IUsageSummaryResponse {
  readonly windowHours: 24;
  readonly total: {
    readonly ingress: number;
    readonly egress: number;
    readonly dlq: number;
  };
  readonly byChannel: readonly IUsageSummaryByChannelEntry[];
}
