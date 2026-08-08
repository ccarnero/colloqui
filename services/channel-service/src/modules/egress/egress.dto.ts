import { Type } from "class-transformer";
import { IsArray, IsIn, IsOptional, IsString } from "class-validator";

export class SendMessageDto {
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
