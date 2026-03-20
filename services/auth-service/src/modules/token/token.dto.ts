import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEnum,
} from 'class-validator';

export enum GrantType {
  CLIENT_CREDENTIALS = 'client_credentials',
}

export class ClientCredentialsDto {
  @IsEnum(GrantType)
  grant_type!: GrantType;

  @IsString()
  @IsNotEmpty()
  client_id!: string;

  @IsString()
  @IsNotEmpty()
  client_secret!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsString()
  tenant_id?: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refresh_token!: string;
}
