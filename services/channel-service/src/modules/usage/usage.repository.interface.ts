import type { IUsageBucketRow, IUsageTotalsRow, UsageBucket } from "./usage.dto";

export const USAGE_REPOSITORY = Symbol("USAGE_REPOSITORY");

export interface IUsageQueryFilters {
  readonly tenantId: string;
  readonly from: Date;
  readonly to: Date;
  readonly bucket: UsageBucket;
  readonly accountId?: string;
  readonly channel?: string;
  readonly direction?: "ingress" | "egress" | "dlq";
}

export interface IUsageTotalsFilters {
  readonly tenantId: string;
  readonly from: Date;
  readonly to: Date;
  readonly accountId?: string;
  readonly channel?: string;
}

export interface IUsageRepository {
  getBuckets(filters: IUsageQueryFilters): Promise<readonly IUsageBucketRow[]>;
  getTotals(filters: IUsageTotalsFilters): Promise<readonly IUsageTotalsRow[]>;
}
