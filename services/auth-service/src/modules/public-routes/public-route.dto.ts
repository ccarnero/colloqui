import { IsIn, IsNotEmpty, IsString, Matches } from "class-validator";
import { CLIENT_SCOPE_REGEX } from "../scope-constants";

const VALID_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "*"] as const;

export class CreatePublicRouteDto {
  @IsString()
  @IsIn(VALID_METHODS)
  method!: string;

  @IsString()
  @IsNotEmpty()
  path_pattern!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(CLIENT_SCOPE_REGEX, {
    message: 'scope must be "platform" or "tenant:<name>"',
  })
  scope!: string;
}
