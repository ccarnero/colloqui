import {
  IsString,
  IsIn,
  IsOptional,
  IsBoolean,
} from "class-validator";

export class CreateAccountDto {
  @IsIn(["whatsapp", "instagram"])
  channel!: "whatsapp" | "instagram";

  @IsOptional()
  @IsIn(["meta"])
  provider?: "meta";

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

export class UpdateAccountDto {
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
