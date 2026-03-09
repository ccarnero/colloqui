import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';

export const VALID_ENVIRONMENTS = [
  'dev',
  'qa',
  'staging',
  'production',
] as const;

export type Environment = (typeof VALID_ENVIRONMENTS)[number];

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message:
      'name must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen',
  })
  name!: string;
}
