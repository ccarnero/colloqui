import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsObject,
} from "class-validator";

/** Meta / WhatsApp webhook verification query (hub.*). */
export class WebhookVerificationQueryDto {
  @IsOptional()
  @IsString()
  "hub.mode"?: string;

  @IsOptional()
  @IsString()
  "hub.verify_token"?: string;

  @IsOptional()
  @IsString()
  "hub.challenge"?: string;
}

/**
 * Passthrough DTO for inbound webhook JSON from all providers (Meta, Telegram).
 * Every known top-level field is whitelisted so the global ValidationPipe
 * (forbidNonWhitelisted) does not reject provider-specific payloads.
 */
export class WebhookInboundBodyDto {
  /** Meta / WhatsApp */
  @IsOptional()
  @IsString()
  object?: string;

  @IsOptional()
  @IsArray()
  entry?: unknown[];

  /** Telegram */
  @IsOptional()
  @IsNumber()
  update_id?: number;

  @IsOptional()
  @IsObject()
  message?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  edited_message?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  channel_post?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  edited_channel_post?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  callback_query?: Record<string, unknown>;
}
