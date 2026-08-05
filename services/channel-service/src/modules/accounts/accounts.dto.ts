import { IsBoolean, IsIn, IsOptional, IsString } from "class-validator";

export class CreateAccountDto {
  // `e2e-tests` is the outbound-only sink channel the automated suite sends
  // through — see the `Channel` union in @yoizen/shared for why it exists.
  @IsIn(["whatsapp", "instagram", "telegram", "http", "e2e-tests"])
  channel!: "whatsapp" | "instagram" | "telegram" | "http" | "e2e-tests";

  @IsOptional()
  @IsIn(["meta", "telegram", "http", "e2e-tests"])
  provider?: "meta" | "telegram" | "http" | "e2e-tests";

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
  @IsIn(["whatsapp", "instagram", "telegram", "http", "e2e-tests"])
  channel?: "whatsapp" | "instagram" | "telegram" | "http" | "e2e-tests";
}
