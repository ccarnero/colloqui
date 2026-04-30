import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MinLength,
} from "class-validator";

export enum UserRole {
  ADMIN = "admin",
  OPERATOR = "operator",
}

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}
