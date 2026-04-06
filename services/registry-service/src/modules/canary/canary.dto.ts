import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  MaxLength,
} from "class-validator";

export class StartCanaryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  image!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  percent!: number;
}

export class UpdateCanaryDto {
  @IsInt()
  @Min(0)
  @Max(100)
  percent!: number;
}
