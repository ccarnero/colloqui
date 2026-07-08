import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard } from "../../guards/tenant.guard";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { NatsPublisher } from "../../providers/nats.provider";
import { TenantId } from "../../providers/tenant.decorator";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { SKBContainersService } from "./containers.service";
// biome-ignore lint/style/useImportType: used as @Body() metatype — needed at runtime for ValidationPipe's class-validator/class-transformer reflection.
import { CreateSKBDto } from "./dto/create-skb.dto";
// biome-ignore lint/style/useImportType: used as @Body() metatype — needed at runtime for ValidationPipe's class-validator/class-transformer reflection.
import { UpdateSKBDto } from "./dto/update-skb.dto";
// biome-ignore lint/style/useImportType: used as @Body() metatype — needed at runtime for ValidationPipe's class-validator/class-transformer reflection.
import {
  SKB_SUPPORTED_EXTENSIONS,
  UploadSKBFileDto,
} from "./dto/upload-skb-file.dto";
import type { SKBContainerRow } from "./types/skb.types";

@Controller("admin/structured-kb/containers")
@UseGuards(TenantGuard)
export class SKBContainersController {
  private readonly logger = new Logger(SKBContainersController.name);

  constructor(
    private readonly service: SKBContainersService,
    private readonly natsPublisher: NatsPublisher
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateSKBDto
  ): Promise<SKBContainerRow> {
    return this.service.createContainer(tenantId, dto.name, dto.description);
  }

  @Get()
  async list(
    @TenantId() tenantId: string,
  ): Promise<SKBContainerRow[]> {
    return this.service.listContainers(tenantId);
  }

  @Get(":id")
  async get(
    @TenantId() tenantId: string,
    @Param("id") id: string
  ): Promise<SKBContainerRow> {
    return this.service.getContainer(tenantId, id);
  }

  @Patch(":id")
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateSKBDto
  ): Promise<SKBContainerRow> {
    return this.service.updateContainer(tenantId, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @TenantId() tenantId: string,
    @Param("id") id: string
  ): Promise<void> {
    await this.service.deleteContainer(tenantId, id);
  }

  /**
   * Uploads a structured file to a container: validates it, creates the
   * `skb_files` row (status 'pending'), and publishes the ingestion event
   * consumed by SKBIngestionWorkerService. Mirrors
   * DocumentsController.uploadFile()'s create-then-publish shape.
   */
  @Post(":id/files")
  @HttpCode(HttpStatus.ACCEPTED)
  async uploadFile(
    @TenantId() tenantId: string,
    @Param("id") containerId: string,
    @Body() dto: UploadSKBFileDto
  ): Promise<{ fileId: string; status: string }> {
    // 404 if the container doesn't exist for this tenant.
    await this.service.getContainer(tenantId, containerId);

    const ext = extname(dto.filename).toLowerCase();
    if (
      !SKB_SUPPORTED_EXTENSIONS.includes(
        ext as (typeof SKB_SUPPORTED_EXTENSIONS)[number]
      )
    ) {
      throw new BadRequestException(
        `Unsupported file extension '${ext || "(none)"}'. Supported: ${SKB_SUPPORTED_EXTENSIONS.join(", ")}`
      );
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(dto.file_base64, "base64");
    } catch {
      throw new BadRequestException("file_base64 is not valid base64");
    }
    if (buffer.length === 0) {
      throw new BadRequestException("File is empty");
    }

    const fileId = randomUUID();
    const categories = dto.categories ?? [];

    const file = await this.service.createFile(tenantId, containerId, {
      fileId,
      originalName: dto.filename,
      categories,
    });

    try {
      await this.natsPublisher.publishSkbFileIngestion(tenantId, {
        containerId,
        fileId,
        fileBase64: dto.file_base64,
        categories,
        sheetName: dto.sheet_name ?? null,
      });
    } catch (err) {
      this.logger.error(`Failed to publish SKB ingestion event: ${err}`);
      throw new ServiceUnavailableException(
        "Failed to queue file for processing. Please try again."
      );
    }

    return { fileId: file.file_id, status: file.status };
  }
}
