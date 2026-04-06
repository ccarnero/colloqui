import { IsString, IsIn, IsOptional } from "class-validator";

/** Query for `GET /channels/auto-reply`. */
export class ListAutoReplyRulesQueryDto {
  @IsOptional()
  @IsString()
  accountId?: string;
}

export class CreateAutoReplyRuleDto {
  @IsString()
  accountId!: string;

  @IsIn(["whatsapp", "instagram"])
  channel!: string;

  @IsString()
  triggerPattern!: string;

  @IsString()
  replyText!: string;
}
