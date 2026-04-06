import { IsOptional, IsString, IsArray } from "class-validator";

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
 * Minimal validated shape for inbound webhook JSON. Gateway uses a permissive
 * `ValidationPipe` on this controller so unknown Meta fields are not stripped.
 */
export class WebhookInboundBodyDto {
  @IsOptional()
  @IsString()
  object?: string;

  @IsOptional()
  @IsArray()
  entry?: unknown[];
}
