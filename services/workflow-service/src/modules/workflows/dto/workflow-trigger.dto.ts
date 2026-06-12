import {
  IsString,
  IsIn,
  IsArray,
  IsOptional,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { Channel, ChannelProvider, TriggerMode } from "@yoizen/shared";

class MessageReceivedTriggerConfigDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accountIds?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(["whatsapp", "instagram", "telegram", "http"], { each: true })
  channels?: Channel[];

  @IsOptional()
  @IsArray()
  @IsIn(["meta", "telegram", "http"], { each: true })
  providers?: ChannelProvider[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  patterns?: string[];
}

export class WorkflowTriggerDto {
  @IsIn(["message_received"])
  type!: "message_received";

  @IsIn(["exclusive", "shared"])
  mode!: TriggerMode;

  @ValidateNested()
  @Type(() => MessageReceivedTriggerConfigDto)
  config!: MessageReceivedTriggerConfigDto;
}
