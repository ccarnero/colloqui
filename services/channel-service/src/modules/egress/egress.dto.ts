import {
  IsString,
  IsIn,
  IsOptional,
  IsArray,
} from "class-validator";

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
  templateComponents?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  caption?: string;
}
