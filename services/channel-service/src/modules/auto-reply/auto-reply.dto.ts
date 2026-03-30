import { IsString, IsIn } from "class-validator";

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
