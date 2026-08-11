import { IsIn, IsOptional, IsString } from "class-validator";

/** Query for `GET /channels/auto-reply`. */
export class ListAutoReplyRulesQueryDto {
  @IsOptional()
  @IsString()
  accountId?: string;
}

export class CreateAutoReplyRuleDto {
  @IsString()
  accountId!: string;

  // Auto-reply is channel-agnostic at runtime (`AutoReplyService` consumes
  // `...received.v1` for every channel and answers through `EgressService`),
  // so the list is simply the surviving channels.
  @IsIn(["telegram", "http", "e2e-tests"])
  channel!: string;

  @IsString()
  triggerPattern!: string;

  @IsString()
  replyText!: string;
}
