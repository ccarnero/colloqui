import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export class ListChannelAccountsQueryDto {
  @IsOptional()
  @IsString()
  channel?: string;
}

export class ChannelStreamQueryDto {
  @IsOptional()
  @IsString()
  kinds?: string;
  @IsOptional()
  @IsString()
  token?: string;
  @IsOptional()
  @IsString()
  tenant?: string;
}

export class ListAutoReplyRulesQueryDto {
  @IsOptional()
  @IsString()
  accountId?: string;
}

/** Mirrors channel-service `CreateAccountDto` for gateway validation. */
export class CreateChannelAccountBodyDto {
  @IsIn(["whatsapp", "instagram", "telegram", "http", "e2e-tests"])
  channel!: "whatsapp" | "instagram" | "telegram" | "http" | "e2e-tests";

  @IsOptional()
  @IsIn(["meta", "telegram", "http", "e2e-tests"])
  provider?: "meta" | "telegram" | "http" | "e2e-tests";

  @IsString()
  name!: string;

  @IsString()
  externalId!: string;

  @IsOptional()
  @IsString()
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  wabaId?: string;

  @IsOptional()
  @IsString()
  igUserId?: string;

  @IsOptional()
  @IsString()
  telegramBotToken?: string;

  @IsString()
  accessToken!: string;

  @IsOptional()
  @IsString()
  appId?: string;

  @IsOptional()
  @IsString()
  appSecret?: string;

  @IsOptional()
  @IsString()
  verifyToken?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateChannelAccountBodyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsString()
  appId?: string;

  @IsOptional()
  @IsString()
  appSecret?: string;

  @IsOptional()
  @IsString()
  verifyToken?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Mirrors channel-service `SendMessageDto`. */
export class SendChannelMessageBodyDto {
  @IsString()
  to!: string;

  @IsIn(["text", "template", "image", "document"])
  type!: "text" | "template" | "image" | "document";

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  templateName?: string;

  @IsOptional()
  @IsString()
  templateLanguage?: string;

  @IsOptional()
  @IsArray()
  @Type(() => Object)
  templateComponents?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  caption?: string;
}

export class UsageQueryGatewayDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;

  @IsOptional()
  @IsIn(["hour", "day"])
  bucket?: "hour" | "day";

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsIn(["ingress", "egress", "dlq"])
  direction?: "ingress" | "egress" | "dlq";
}

export class UsageTotalsQueryGatewayDto {
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

export const STREAM_INSPECTION_MODES = ["last-per-subject", "tail"] as const;
export type StreamInspectionMode = (typeof STREAM_INSPECTION_MODES)[number];

export class StreamMessagesQueryGatewayDto {
  @IsOptional()
  @IsString()
  subject?: string;

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

/** Mirrors channel-service `CreateAutoReplyRuleDto`. */
export class CreateAutoReplyRuleBodyDto {
  @IsString()
  accountId!: string;

  @IsIn(["whatsapp", "instagram"])
  channel!: string;

  @IsString()
  triggerPattern!: string;

  @IsString()
  replyText!: string;
}
