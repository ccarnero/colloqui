import {
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
} from 'class-validator';

const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', '*'] as const;

export class CreatePublicRouteDto {
  @IsString()
  @IsIn(VALID_METHODS)
  method!: string;

  @IsString()
  @IsNotEmpty()
  path_pattern!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(platform|tenant:[a-z0-9]([a-z0-9-]*[a-z0-9])?)$/, {
    message: 'scope must be "platform" or "tenant:<name>"',
  })
  scope!: string;
}
