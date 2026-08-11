import type { Channel, ChannelProvider, TriggerMode } from "@yoizen/shared";
import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

class MessageReceivedTriggerConfigDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accountIds?: string[];

  // Both lists mirror the `Channel` / `ChannelProvider` unions in
  // @yoizen/shared — the Meta family (`whatsapp`/`instagram` + provider
  // `meta`) was decommissioned and left them.
  @IsOptional()
  @IsArray()
  @IsIn(["telegram", "http", "e2e-tests"], { each: true })
  channels?: Channel[];

  @IsOptional()
  @IsArray()
  @IsIn(["telegram", "http", "e2e-tests"], { each: true })
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
