import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";

/**
 * Passthrough DTO for inbound webhook JSON from all providers (Telegram, Http).
 * Every known top-level field is whitelisted so the global ValidationPipe
 * (forbidNonWhitelisted) does not reject provider-specific payloads.
 */
export class WebhookInboundBodyDto {
  /** Generic envelope-style payloads (`object` + `entry` array). */
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
