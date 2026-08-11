import { IsBoolean, IsIn, IsOptional, IsString } from "class-validator";

export class CreateAccountDto {
  // `e2e-tests` is the outbound-only sink channel the automated suite sends
  // through — see the `Channel` union in @yoizen/shared for why it exists.
  @IsIn(["telegram", "http", "e2e-tests"])
  channel!: "telegram" | "http" | "e2e-tests";

  @IsOptional()
  @IsIn(["telegram", "http", "e2e-tests"])
  provider?: "telegram" | "http" | "e2e-tests";

  @IsString()
  name!: string;

  @IsString()
  externalId!: string;

  @IsOptional()
  @IsString()
  telegramBotToken?: string;

  @IsString()
  accessToken!: string;

  /**
   * Webhook verification secret. Telegram sends it back in
   * `x-telegram-bot-api-secret-token`, Http in `x-http-channel-token`;
   * omitted on create, the service generates one.
   */
  @IsOptional()
  @IsString()
  appSecret?: string;

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
  appSecret?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Query params for `GET /channels/accounts`. */
export class ListAccountsQueryDto {
  @IsOptional()
  @IsIn(["telegram", "http", "e2e-tests"])
  channel?: "telegram" | "http" | "e2e-tests";
}
