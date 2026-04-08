import {
  IsString,
  IsIn,
  IsOptional,
  IsBoolean,
  IsArray,
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
  @IsIn(["whatsapp", "instagram", "telegram"])
  channel!: "whatsapp" | "instagram" | "telegram";

  @IsOptional()
  @IsIn(["meta", "telegram"])
  provider?: "meta" | "telegram";

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
  templateComponents?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  caption?: string;
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
