import { IsString, IsNotEmpty, IsOptional, IsIn } from "class-validator";

export class UploadDocumentDto {
  @IsString()
  @IsNotEmpty()
  content_text!: string;

  @IsString()
  @IsNotEmpty()
  original_filename!: string;

  @IsString()
  @IsNotEmpty()
  mime_type!: string;

  @IsString()
  @IsIn(["text", "markdown", "pdf", "csv", "html", "docx"])
  content_type!: string;
}

export class UploadFileDocumentDto {
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @IsString()
  @IsNotEmpty()
  file_base64!: string;

  @IsString()
  @IsIn(["auto", "text", "markdown", "pdf", "csv", "html", "docx"])
  content_type!: string;
}
