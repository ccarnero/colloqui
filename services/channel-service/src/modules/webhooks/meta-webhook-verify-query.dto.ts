import { Expose } from "class-transformer";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/** Meta `GET` webhook verification query (`hub.*` params). */
export class MetaWebhookVerifyQueryDto {
  @Expose({ name: "hub.mode" })
  @IsOptional()
  @IsString()
  @IsIn(["subscribe"])
  mode?: string;

  @Expose({ name: "hub.verify_token" })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  verifyToken?: string;

  @Expose({ name: "hub.challenge" })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  challenge?: string;
}
