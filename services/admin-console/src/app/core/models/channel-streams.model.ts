export type UsageDirection = "ingress" | "egress" | "dlq";
export type UsageBucket = "hour" | "day";

export interface IUsageBucketRow {
  readonly bucket: string;
  readonly accountId: string;
  readonly channel: string;
  readonly direction: UsageDirection;
  readonly events: number;
}

export interface IUsageTotalsRow {
  readonly direction: UsageDirection;
  readonly events: number;
  readonly firstTs: string | null;
  readonly lastTs: string | null;
}

export interface IUsageQueryParams {
  readonly from: string;
  readonly to: string;
  readonly bucket?: UsageBucket;
  readonly accountId?: string;
  readonly channel?: string;
  readonly direction?: UsageDirection;
}

export interface IUsageTotalsQueryParams {
  readonly from: string;
  readonly to: string;
  readonly accountId?: string;
  readonly channel?: string;
}

export interface IStreamSummary {
  readonly name: string;
  readonly kind: "ingress" | "dlq";
  readonly subjects: readonly string[];
  readonly messages: number;
  readonly bytes: number;
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly firstTs: string | null;
  readonly lastTs: string | null;
  readonly maxAgeNs: number;
  readonly maxBytes: number;
  readonly consumerCount: number;
}

export interface IStreamMessage {
  readonly seq: number;
  readonly subject: string;
  readonly ts: string;
  readonly headers: Record<string, string>;
  readonly data: unknown;
  readonly size: number;
}

export type StreamInspectionMode = "last-per-subject" | "tail";

export interface IStreamMessagesQueryParams {
  readonly subject?: string;
  readonly accountId?: string;
  readonly limit?: number;
  readonly mode?: StreamInspectionMode;
}
