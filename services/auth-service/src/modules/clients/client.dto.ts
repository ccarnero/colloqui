import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(platform|tenant:[a-z0-9]([a-z0-9-]*[a-z0-9])?)$/, {
    message: 'scope must be "platform" or "tenant:<name>" with lowercase alphanumeric tenant name',
  })
  scope!: string;
}
