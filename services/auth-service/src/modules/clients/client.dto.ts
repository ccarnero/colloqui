import { IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";
import { CLIENT_SCOPE_REGEX } from "../scope-constants";

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(CLIENT_SCOPE_REGEX, {
    message:
      'scope must be "platform" or "tenant:<name>" with lowercase alphanumeric tenant name',
  })
  scope!: string;
}
