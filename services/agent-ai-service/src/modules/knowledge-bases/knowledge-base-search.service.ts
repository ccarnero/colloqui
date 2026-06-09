import { Inject, Injectable, Logger } from "@nestjs/common";
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { AgentAiTenantConnectionManager } from "../../providers/tenant-connection.manager";
import type { TenantConnectionManager } from "@yoizen/database";

export interface KbSearchResult {
  content: string;
  score: number;
  documentId: string;
  kbId: string;
}

@Injectable()
export class KnowledgeBaseSearchService {
  private readonly logger = new Logger(KnowledgeBaseSearchService.name);

  constructor(
    @Inject(AgentAiTenantConnectionManager)
    private readonly connectionManager: TenantConnectionManager & {
      ensureSchema(tenantId: string): any;
    },
  ) {}

  async search(
    tenantId: string,
    kbIds: string[],
    query: string,
    options?: { topK?: number; minScore?: number },
  ): Promise<KbSearchResult[]> {
    if (kbIds.length === 0 || !query) return [];

    const topK = options?.topK ?? 5;
    const minScore = options?.minScore ?? 0.5;

    try {
      const sql = await this.connectionManager.ensureSchema(tenantId);

      const modelRows = await (sql as any).unsafe(
        `SELECT DISTINCT dce.model FROM document_chunks_embedding dce
         JOIN document_chunks dc ON dce.chunk_id = dc.id
         WHERE dc.knowledge_base_id = ANY($1::uuid[]) AND dce.model IS NOT NULL`,
        [`{${kbIds.join(",")}}`],
      );
      const models: string[] = modelRows?.length > 0
        ? modelRows.map((r: any) => r.model)
        : ["text-embedding-3-small"];

      const allResults: KbSearchResult[] = [];
      for (const model of models) {
        const { embedding } = await embed({
          model: openai.embedding(model),
          value: query.replace(/\n/g, " "),
        });
        const embeddingStr = `[${embedding.join(",")}]`;
        const results: KbSearchResult[] = await (sql as any).unsafe(
          `SELECT
            dc.content,
            1 - (dce.embedding <=> $1::vector) AS score,
            dc.document_id AS "documentId",
            dc.knowledge_base_id AS "kbId"
          FROM document_chunks dc
          JOIN document_chunks_embedding dce ON dce.chunk_id = dc.id
          WHERE dc.knowledge_base_id = ANY($2::uuid[])
            AND dce.model = $3
            AND 1 - (dce.embedding <=> $1::vector) > $4
          ORDER BY score DESC
          LIMIT $5`,
          [embeddingStr, `{${kbIds.join(",")}}`, model, minScore, topK],
        );
        allResults.push(...(results ?? []));
      }

      allResults.sort((a, b) => b.score - a.score);
      return allResults.slice(0, topK);
    } catch (error) {
      this.logger.error(
        `KB search failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return [];
    }
  }
}
