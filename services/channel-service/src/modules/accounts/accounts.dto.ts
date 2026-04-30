import { IsString, IsIn, IsOptional, IsBoolean } from "class-validator";

export class CreateAccountDto {
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

/** Response shape for `POST /channels/accounts/:id/refresh-token`. */
export class RefreshTokenResponseDto {
  accessToken!: string;
  tokenType!: string;
  expiresIn!: number;
}

/** Query params for `GET /channels/accounts`. */
export class ListAccountsQueryDto {
  @IsOptional()
  @IsIn(["whatsapp", "instagram", "telegram"])
  channel?: "whatsapp" | "instagram" | "telegram";
}
