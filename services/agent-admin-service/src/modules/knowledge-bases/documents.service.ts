import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Sql, TenantConnectionManager } from "@yoizen/database";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { PermanentError } from "@yoizen/shared";
import type { ChunkingStrategy } from "@yoizen/shared";
import { ChunkerRegistry } from "./chunkers/chunker-registry";

export interface IIngestionConfig {
  chunk_size?: number;
  chunk_overlap?: number;
  embedding_model?: string;
  provider_connector_id?: string;
  chunking_strategy?: "character" | "recursive" | "semantic" | "title_segmentation";
  api_key?: string;
  provider?: string;
  api_base_url?: string;
  api_version?: string;
}

export interface IDocumentRow {
  id: string;
  tenant_id: string;
  knowledge_base_id: string;
  original_filename: string;
  mime_type: string;
  content_type: string;
  content_text: string | null;
  file_size: number;
  chunk_count: number;
  status: string;
  error_message: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface IChunkRow {
  id: string;
  tenant_id: string;
  document_id: string;
  knowledge_base_id: string;
  chunk_index: number;
  content: string;
  is_edited: boolean;
  edited_at: Date | null;
  created_at: Date;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    private readonly connectionManager: TenantConnectionManager,
    private readonly chunkerRegistry: ChunkerRegistry,
  ) {}

  async findAll(
    tenantId: string,
    kbId: string,
  ): Promise<{ documents: IDocumentRow[]; total: number }> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const [countRow] = await sql`
      SELECT COUNT(*) as count FROM documents WHERE tenant_id = ${tenantId} AND knowledge_base_id = ${kbId} AND is_active = true
    `;
    const total = Number((countRow as Record<string, unknown>).count ?? 0);
    const documents = await sql<IDocumentRow[]>`
      SELECT id, tenant_id, knowledge_base_id, original_filename, mime_type, content_type, content_text, file_size, chunk_count, status, error_message, is_active, created_at, updated_at
      FROM documents
      WHERE tenant_id = ${tenantId} AND knowledge_base_id = ${kbId} AND is_active = true
      ORDER BY created_at DESC
    `;
    return { documents, total };
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<IDocumentRow | null> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const [row] = await sql<IDocumentRow[]>`
      SELECT id, tenant_id, knowledge_base_id, original_filename, mime_type, content_type, content_text, file_size, chunk_count, status, error_message, is_active, created_at, updated_at
      FROM documents
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      LIMIT 1
    `;
    return row ?? null;
  }

  async create(
    tenantId: string,
    kbId: string,
    data: {
      content_text: string;
      original_filename: string;
      mime_type: string;
      content_type: string;
    },
  ): Promise<IDocumentRow> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const id = randomUUID();
    const fileSize = Buffer.byteLength(data.content_text, "utf-8");
    const [row] = await sql<IDocumentRow[]>`
      INSERT INTO documents (id, tenant_id, knowledge_base_id, original_filename, mime_type, content_type, content_text, file_size, status)
      VALUES (${id}, ${tenantId}, ${kbId}, ${data.original_filename}, ${data.mime_type}, ${data.content_type}, ${data.content_text}, ${fileSize}, 'pending')
      RETURNING id, tenant_id, knowledge_base_id, original_filename, mime_type, content_type, content_text, file_size, chunk_count, status, error_message, is_active, created_at, updated_at
    `;
    return row;
  }

  async extractTextFromFile(
    base64Content: string,
    contentType: string,
    _filename: string,
  ): Promise<string> {
    const buffer = Buffer.from(base64Content, "base64");

    switch (contentType) {
      case "docx": {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      }
      case "pdf": {
        const { PDFParse } = await import("pdf-parse");
        const pdf = new PDFParse({ data: buffer });
        const result = await pdf.getText();
        return result.text;
      }
      case "text":
      case "markdown":
      case "csv":
      case "html":
        return buffer.toString("utf-8");
      default:
        throw new Error(`Unsupported content type: ${contentType}`);
    }
  }

  /**
   * Resolves a file extension to a content type string.
   */
  private resolveContentType(
    filename: string,
    contentType: string,
  ): string {
    if (contentType !== "auto") return contentType;
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "docx" || ext === "doc") return "docx";
    if (ext === "pdf") return "pdf";
    if (ext === "md") return "markdown";
    if (ext === "txt") return "text";
    if (ext === "csv") return "csv";
    if (ext === "html" || ext === "htm") return "html";
    return "text";
  }

  /**
   * Returns a MIME type string for the given content type.
   */
  private mimeTypeFor(contentType: string): string {
    const mimeTypes: Record<string, string> = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pdf: "application/pdf",
      text: "text/plain",
      markdown: "text/markdown",
      csv: "text/csv",
      html: "text/html",
    };
    return mimeTypes[contentType] ?? "text/plain";
  }

  /**
   * Creates a minimal document record from a file upload.
   * The actual text extraction + chunking + embedding runs asynchronously
   * via the ingestion worker.
   */
  async createFromFile(
    tenantId: string,
    kbId: string,
    data: { filename: string; file_base64: string; content_type: string },
  ): Promise<IDocumentRow> {
    const sql = await this.connectionManager.ensureSchema(tenantId);

    const contentType = this.resolveContentType(
      data.filename,
      data.content_type,
    );
    const mimeType = this.mimeTypeFor(contentType);
    const docId = randomUUID();
    const fileSize = Buffer.byteLength(data.file_base64, "base64");

    const [row] = await sql<IDocumentRow[]>`
      INSERT INTO documents (id, tenant_id, knowledge_base_id, original_filename, mime_type, content_type, file_size, status)
      VALUES (${docId}, ${tenantId}, ${kbId}, ${data.filename}, ${mimeType}, ${contentType}, ${fileSize}, 'pending')
      RETURNING id, tenant_id, knowledge_base_id, original_filename, mime_type, content_type, content_text, file_size, chunk_count, status, error_message, is_active, created_at, updated_at
    `;

    return row;
  }

  /**
   * Updates the content_text for a document after the worker has
   * extracted it from the source file.
   */
  async updateContentText(
    tenantId: string,
    docId: string,
    contentText: string,
  ): Promise<void> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const fileSize = Buffer.byteLength(contentText, "utf-8");
    await sql`
      UPDATE documents
      SET content_text = ${contentText}, file_size = ${fileSize}, updated_at = NOW()
      WHERE id = ${docId} AND tenant_id = ${tenantId}
    `;
  }

  async ingest(tenantId: string, docId: string): Promise<void> {
    const sql = await this.connectionManager.ensureSchema(tenantId);

    // Fetch the document
    const doc = await this.findById(tenantId, docId);
    if (!doc || !doc.content_text) {
      throw new PermanentError(
        `Document ${docId} not found or has no content`,
        "documents-ingest",
      );
    }

    // Fetch KB config for ingestion settings
    const [kbRow] = await sql<{ ingestion_config: unknown }[]>`
      SELECT ingestion_config FROM knowledge_bases WHERE id = ${doc.knowledge_base_id} AND tenant_id = ${tenantId} LIMIT 1
    `;
    const rawConfig = kbRow?.ingestion_config;
    const kbConfig: IIngestionConfig =
      typeof rawConfig === "object" && rawConfig !== null
        ? (rawConfig as IIngestionConfig)
        : {};
    const chunkSize = kbConfig.chunk_size ?? 1000;
    const chunkOverlap = kbConfig.chunk_overlap ?? 200;
    const embeddingModel = kbConfig.embedding_model ?? "text-embedding-3-small";

    // Update status to processing
    await sql`
      UPDATE documents
      SET status = 'processing', updated_at = NOW()
      WHERE id = ${docId}
    `;

    try {
      const text = doc.content_text;

      const strategy: ChunkingStrategy = kbConfig.chunking_strategy ?? "character";
      const chunker = this.chunkerRegistry.getStrategy(strategy);
      const rawChunks = chunker.chunk(text, {
        chunkSize,
        chunkOverlap,
        strategy,
      });

      const validChunks = rawChunks.filter((c) => c.length > 20);
      if (validChunks.length === 0) {
        validChunks.push(text.trim());
      }

      await sql`
        DELETE FROM document_chunks
        WHERE document_id = ${docId} AND tenant_id = ${tenantId}
      `;

      const credentials = await this.resolveProviderCredentials(tenantId, kbConfig);
      const apiBase = credentials.baseUrl ?? "https://api.openai.com/v1";

      const BATCH_SIZE = 100;
      const embeddings: number[][] = [];

      for (let batchStart = 0; batchStart < validChunks.length; batchStart += BATCH_SIZE) {
        const batch = validChunks.slice(batchStart, batchStart + BATCH_SIZE);

        const embedResponse = await fetch(`${apiBase}/embeddings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${credentials.apiKey}`,
          },
          body: JSON.stringify({
            model: embeddingModel,
            input: batch,
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!embedResponse.ok) {
          const errorText = await embedResponse.text();
          throw new Error(`OpenAI embeddings API error (${embedResponse.status}): ${errorText}`);
        }

        const embedData = await embedResponse.json() as {
          data: Array<{ embedding: number[] }>;
        };

        for (const d of embedData.data) {
          embeddings.push(d.embedding);
        }
      }

      if (embeddings.length !== validChunks.length) {
        throw new Error(`Embedding count mismatch: expected ${validChunks.length}, got ${embeddings.length}`);
      }

      // Store chunks with embeddings
      for (let i = 0; i < validChunks.length; i++) {
        const chunkId = randomUUID();
        await sql`
          INSERT INTO document_chunks (id, tenant_id, document_id, knowledge_base_id, chunk_index, content)
          VALUES (${chunkId}, ${tenantId}, ${docId}, ${doc.knowledge_base_id}, ${i}, ${validChunks[i]})
        `;

        // pgvector requires ::vector cast — use parameterized query for safety
        const embeddingStr = `[${embeddings[i].join(",")}]`;
        await (sql as Sql).unsafe(
          `INSERT INTO document_chunks_embedding (chunk_id, embedding, model) VALUES ($1, $2::vector, $3)`,
          [chunkId, embeddingStr, embeddingModel],
        );
      }

      // Update document status to ready
      await sql`
        UPDATE documents
        SET status = 'ready', chunk_count = ${validChunks.length}, updated_at = NOW()
        WHERE id = ${docId}
      `;

      this.logger.log(
        `Ingested document ${docId}: ${validChunks.length} chunks with embeddings stored (model: ${embeddingModel}, chunk_size: ${chunkSize}, overlap: ${chunkOverlap})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : "";
      this.logger.error(
        `Failed to ingest document ${docId}: ${message}${stack ? `\n${stack}` : ""}`,
      );
      try {
        await sql`
          UPDATE documents SET status = 'failed', error_message = ${message}, updated_at = NOW()
          WHERE id = ${docId}
        `;
      } catch (dbError) {
        this.logger.error(
          `Failed to update document status for ${docId}: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
        );
      }
    }
  }

  async findChunksByDocumentId(
    tenantId: string,
    documentId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<{
    chunks: Array<{ id: string; chunk_index: number; content: string; char_count: number; is_edited: boolean; edited_at: Date | null }>;
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  }> {
    const sql = await this.connectionManager.ensureSchema(tenantId);

    // Validate document exists and is ready
    const doc = await this.findById(tenantId, documentId);
    if (!doc) {
      throw new Error("Document not found");
    }

    const offset = (page - 1) * limit;

    const [countRow] = await sql`
      SELECT COUNT(DISTINCT chunk_index) as count FROM document_chunks
      WHERE document_id = ${documentId} AND tenant_id = ${tenantId}
    `;
    const total = Number((countRow as Record<string, unknown>).count ?? 0);

    const chunks = await sql<Array<{ id: string; chunk_index: number; content: string; char_count: number; is_edited: boolean; edited_at: Date | null }>>`
      SELECT DISTINCT ON (chunk_index) id, chunk_index, content, LENGTH(content) as char_count, is_edited, edited_at
      FROM document_chunks
      WHERE document_id = ${documentId} AND tenant_id = ${tenantId}
      ORDER BY chunk_index ASC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return {
      chunks,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    };
  }

  async updateChunk(
    tenantId: string,
    chunkId: string,
    newContent: string,
    embeddingModel: string = "text-embedding-3-small",
  ): Promise<{ id: string; chunk_index: number; content: string; char_count: number; is_edited: boolean; edited_at: Date | null }> {
    const sql = await this.connectionManager.ensureSchema(tenantId);

    const [existing] = await sql`
      SELECT id, document_id, knowledge_base_id FROM document_chunks
      WHERE id = ${chunkId} AND tenant_id = ${tenantId}
      LIMIT 1
    `;
    if (!existing) {
      throw new Error("Chunk not found");
    }

    await sql`
      UPDATE document_chunks
      SET content = ${newContent}, is_edited = TRUE, edited_at = NOW(), updated_at = NOW()
      WHERE id = ${chunkId} AND tenant_id = ${tenantId}
    `;

    const [kbRow] = await sql<{ ingestion_config: unknown }[]>`
      SELECT ingestion_config FROM knowledge_bases
      WHERE id = ${existing.knowledge_base_id} AND tenant_id = ${tenantId} LIMIT 1
    `;
    const rawConfig = kbRow?.ingestion_config;
    const kbConfig = typeof rawConfig === "object" && rawConfig !== null ? rawConfig as IIngestionConfig : {};
    const model = kbConfig.embedding_model ?? embeddingModel;

    const credentials = await this.resolveProviderCredentials(tenantId, kbConfig);
    const apiBase = credentials.baseUrl ?? "https://api.openai.com/v1";

    const embedResponse = await fetch(`${apiBase}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.apiKey}` },
      body: JSON.stringify({ model, input: [newContent] }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!embedResponse.ok) {
      throw new Error(`Embedding API error (${embedResponse.status})`);
    }

    const embedData = await embedResponse.json() as { data: Array<{ embedding: number[] }> };
    const embedding = embedData.data[0].embedding;

    const embeddingStr = `[${embedding.join(",")}]`;
    await (sql as Sql).unsafe(
      `UPDATE document_chunks_embedding SET embedding = $1::vector, model = $2 WHERE chunk_id = $3`,
      [embeddingStr, model, chunkId],
    );

    await sql`
      UPDATE documents SET updated_at = NOW() WHERE id = ${existing.document_id} AND tenant_id = ${tenantId}
    `;

    const [updated] = await sql<{ id: string; chunk_index: number; content: string; char_count: number; is_edited: boolean; edited_at: Date | null }[]>`
      SELECT id, chunk_index, content, LENGTH(content) as char_count, is_edited, edited_at
      FROM document_chunks WHERE id = ${chunkId} AND tenant_id = ${tenantId}
    `;
    return updated;
  }

  private async resolveProviderCredentials(
    tenantId: string,
    kbConfig: IIngestionConfig,
  ): Promise<{ apiKey: string; baseUrl?: string }> {
    if (kbConfig.api_key && kbConfig.provider) {
      return {
        apiKey: kbConfig.api_key,
        baseUrl: kbConfig.api_base_url,
      };
    }

    if (kbConfig.provider_connector_id) {
      try {
        const connectorUrl = process.env.CONNECTOR_ADMIN_URL
          ?? "http://connector-admin-api.platform-services-dev.svc.cluster.local";
        const res = await fetch(
          `${connectorUrl}/connectors/${kbConfig.provider_connector_id}`,
          { headers: { "x-yoizen-tenant": tenantId } },
        );
        if (!res.ok) {
          this.logger.warn(
            `Connector fetch failed (${res.status}) for ${kbConfig.provider_connector_id}, falling back to env-var`,
          );
        } else {
          const connector = await res.json() as {
            baseUrl?: string;
            authConfig?: Record<string, string>;
          };
          const apiKey = connector.authConfig?.bearerToken ?? connector.authConfig?.apiKey;
          if (apiKey) {
            return { apiKey, baseUrl: connector.baseUrl };
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed to fetch connector ${kbConfig.provider_connector_id}: ${err instanceof Error ? err.message : String(err)}. Falling back to env-var`,
        );
      }
    }

    const envApiKey = process.env.OPENAI_API_KEY;
    if (!envApiKey) {
      throw new Error(
        "No API key configured: set OPENAI_API_KEY env var, provide api_key in config, or configure a provider_connector_id",
      );
    }
    return { apiKey: envApiKey };
  }

  async resetForReingestion(tenantId: string, docId: string): Promise<void> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    // Delete existing chunks (CASCADE cleans embeddings)
    await sql`
      DELETE FROM document_chunks
      WHERE document_id = ${docId} AND tenant_id = ${tenantId}
    `;
    // Reset document status
    await sql`
      UPDATE documents
      SET status = 'pending', error_message = NULL, chunk_count = 0, updated_at = NOW()
      WHERE id = ${docId} AND tenant_id = ${tenantId}
    `;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const result = await sql`
      UPDATE documents
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      RETURNING id
    `;
    return result.length > 0;
  }

  /**
   * Resets documents that have been stuck in 'processing' for more than
   * the specified threshold. Called by the ingestion watchdog cron.
   *
   * Iterates all known tenants and marks matching documents as 'failed'
   * with a descriptive error_message so users can retry via the UI.
   *
   * @returns Array of documents that were reset.
   */
  async resetStuckProcessingDocuments(
    stuckThresholdMinutes: number = 10,
  ): Promise<Array<{ id: string; tenant_id: string; knowledge_base_id: string }>> {
    const tenantIds = this.connectionManager.getKnownTenantIds();
    if (tenantIds.length === 0) {
      return [];
    }

    const allReset: Array<{ id: string; tenant_id: string; knowledge_base_id: string }> = [];

    for (const tenantId of tenantIds) {
      try {
        const sql = await this.connectionManager.ensureSchema(tenantId);
        const reset = await sql<Array<{ id: string; tenant_id: string; knowledge_base_id: string }>>`
          UPDATE documents
          SET status = 'failed',
              error_message = 'Document stuck in processing — watchdog auto-reset after ' || ${stuckThresholdMinutes.toString()} || ' minutes',
              updated_at = NOW()
          WHERE status = 'processing'
            AND updated_at < NOW() - (${stuckThresholdMinutes.toString()} || ' minutes')::INTERVAL
            AND is_active = true
          RETURNING id, tenant_id, knowledge_base_id
        `;

        for (const doc of reset) {
          this.logger.warn(
            `Watchdog: reset stuck document ${doc.id} (tenant=${doc.tenant_id}, kb=${doc.knowledge_base_id}) — was in 'processing' for >${stuckThresholdMinutes}min`,
          );
        }

        allReset.push(...reset);
      } catch (err) {
        this.logger.error(
          `Watchdog: failed to check stuck documents for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return allReset;
  }
}
// force rebuild dom 07 jun 2026 15:06:32 -03
