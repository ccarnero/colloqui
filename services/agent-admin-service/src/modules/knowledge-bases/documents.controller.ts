import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";
import { DocumentsService } from "./documents.service";
import { NatsPublisher } from "../../providers/nats.provider";
import { UploadDocumentDto, UploadFileDocumentDto } from "./documents.dto";

@Controller("admin/knowledge-bases/:kbId/documents")
@UseGuards(TenantGuard)
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @TenantId() tenantId: string,
    @Param("kbId") kbId: string,
  ) {
    return this.documentsService.findAll(tenantId, kbId);
  }

  @Get(":id/chunks")
  @HttpCode(HttpStatus.OK)
  async findChunks(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.documentsService.findChunksByDocumentId(
      tenantId,
      id,
      Math.max(1, Number(page) || 1),
      Math.min(100, Math.max(1, Number(limit) || 50)),
    );
  }

  @Put(":docId/chunks/:chunkId")
  @HttpCode(HttpStatus.OK)
  async updateChunk(
    @TenantId() tenantId: string,
    @Param("docId") docId: string,
    @Param("chunkId") chunkId: string,
    @Body() body: { content: string },
  ) {
    return this.documentsService.updateChunk(tenantId, chunkId, body.content);
  }

  @Get(":id")
  @HttpCode(HttpStatus.OK)
  async findById(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ) {
    return this.documentsService.findById(tenantId, id);
  }

  @Post("upload")
  @HttpCode(HttpStatus.ACCEPTED)
  async upload(
    @TenantId() tenantId: string,
    @Param("kbId") kbId: string,
    @Body() body: UploadDocumentDto,
  ) {
    const doc = await this.documentsService.create(tenantId, kbId, body);
    // Publish event for worker to process asynchronously
    try {
      await this.natsPublisher.publishDocumentIngestion(tenantId, kbId, {
        documentId: doc.id,
        filename: body.original_filename,
        contentType: body.content_type,
      });
    } catch (err) {
      this.logger.error(`Failed to publish ingestion event: ${err}`);
      throw new ServiceUnavailableException("Failed to queue document for processing. Please try again.");
    }
    return { documentId: doc.id, status: "pending" };
  }

  @Post("upload-file")
  @HttpCode(HttpStatus.ACCEPTED)
  async uploadFile(
    @TenantId() tenantId: string,
    @Param("kbId") kbId: string,
    @Body() body: UploadFileDocumentDto,
  ) {
    const doc = await this.documentsService.createFromFile(
      tenantId,
      kbId,
      body,
    );
    // For file uploads, extract text first then update content
    const contentText = await this.documentsService.extractTextFromFile(
      body.file_base64,
      doc.content_type,
      body.filename,
    );
    await this.documentsService.updateContentText(tenantId, doc.id, contentText);
    // Publish event for worker to process asynchronously
    try {
      await this.natsPublisher.publishDocumentIngestion(tenantId, kbId, {
        documentId: doc.id,
        filename: body.filename,
        contentType: doc.content_type,
      });
    } catch (err) {
      this.logger.error(`Failed to publish ingestion event: ${err}`);
      throw new ServiceUnavailableException("Failed to queue document for processing. Please try again.");
    }
    return { documentId: doc.id, status: "pending" };
  }

  @Post(":id/reingest")
  @HttpCode(HttpStatus.ACCEPTED)
  async reingest(
    @TenantId() tenantId: string,
    @Param("kbId") kbId: string,
    @Param("id") id: string,
  ) {
    const doc = await this.documentsService.findById(tenantId, id);
    if (!doc) {
      throw new NotFoundException("Document not found");
    }
    if (doc.knowledge_base_id !== kbId) {
      throw new NotFoundException("Document not found in this knowledge base");
    }

    await this.documentsService.resetForReingestion(tenantId, id);

    try {
      await this.natsPublisher.publishDocumentIngestion(tenantId, kbId, {
        documentId: doc.id,
        filename: doc.original_filename,
        contentType: doc.content_type,
      });
    } catch (err) {
      this.logger.error(`Failed to publish reingestion event: ${err}`);
      throw new ServiceUnavailableException("Failed to queue document for processing. Please try again.");
    }

    return { documentId: doc.id, status: "pending" };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async delete(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ) {
    return this.documentsService.delete(tenantId, id);
  }
}
