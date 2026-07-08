import { IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";

/** File extensions the SKB ingestion worker's parser can read. */
export const SKB_SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".xls"] as const;

export class UploadSKBFileDto {
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @IsString()
  @IsNotEmpty()
  file_base64!: string;

  @IsArray()
  @IsOptional()
  categories?: string[];

  @IsString()
  @IsOptional()
  sheet_name?: string;
}
