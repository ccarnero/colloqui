import { IsString, IsNotEmpty, IsOptional, IsIn, IsUrl, IsObject, IsBoolean, Length } from "class-validator";

export class CreateMcpServerDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsIn(["http", "sse"])
  transport_type!: "http" | "sse";

  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  url!: string;

  @IsObject()
  @IsOptional()
  headers?: Record<string, string>;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class UpdateMcpServerDto {
  @IsString()
  @IsOptional()
  @Length(1, 255)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string | null;

  @IsString()
  @IsOptional()
  @IsIn(["http", "sse"])
  transport_type?: "http" | "sse";

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @IsObject()
  @IsOptional()
  headers?: Record<string, string> | null;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
