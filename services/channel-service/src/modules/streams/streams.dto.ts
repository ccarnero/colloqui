import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export const STREAM_INSPECTION_MODES = [
  "last-per-subject",
  "tail",
] as const;
export type StreamInspectionMode = (typeof STREAM_INSPECTION_MODES)[number];

export class StreamMessagesQueryDto {
  @IsOptional()
  @IsString()
  subject?: string;

  /** When set, only messages whose envelope `accountid` matches are returned. */
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsIn(STREAM_INSPECTION_MODES as unknown as string[])
  mode?: StreamInspectionMode;
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
