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

/**
 * Mirrors channel-service `CreateAccountDto` for gateway validation.
 *
 * The Meta channel family is decommissioned: the `whatsapp`/`instagram`
 * channel tokens, the `meta` provider and the Meta-only account fields
 * (`phoneNumberId`, `wabaId`, `igUserId`, `appId`, `verifyToken`) are gone
 * downstream, so the gateway rejects them here instead of proxying a body
 * channel-service would strip. `appSecret` stays — Telegram and Http use it
 * as their webhook verification secret.
 */
export class CreateChannelAccountBodyDto {
  @IsIn(["telegram", "http", "e2e-tests"])
  channel!: "telegram" | "http" | "e2e-tests";

  @IsOptional()
  @IsIn(["telegram", "http", "e2e-tests"])
  provider?: "telegram" | "http" | "e2e-tests";

  @IsString()
  name!: string;

  @IsString()
  externalId!: string;

  @IsOptional()
  @IsString()
  telegramBotToken?: string;

  @IsString()
  accessToken!: string;

  @IsOptional()
  @IsString()
  appSecret?: string;

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
  appSecret?: string;

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

  // Kept in step with channel-service's `CreateAutoReplyRuleDto` @IsIn:
  // auto-reply is channel-agnostic, so it serves every surviving channel.
  @IsIn(["telegram", "http", "e2e-tests"])
  channel!: string;

  @IsString()
  triggerPattern!: string;

  @IsString()
  replyText!: string;
}
