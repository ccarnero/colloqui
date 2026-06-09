import { Injectable, Logger } from "@nestjs/common";
import { cosineSimilarity } from "ai";
import { createEmbeddingClient } from "./embedding-clients/embedding-client.factory";
import type { IEmbeddingClient, EmbeddingClientConfig } from "@yoizen/shared";

export interface EmbeddingResult {
  readonly embedding: number[];
  readonly tokens: number;
}

export interface EmbeddingSearchResult {
  readonly text: string;
  readonly score: number;
  readonly metadata?: Record<string, unknown>;
}

const DEFAULT_CONFIG: EmbeddingClientConfig = {
  provider: "openai",
  apiKey: process.env.OPENAI_API_KEY ?? "",
};

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private client: IEmbeddingClient;

  constructor() {
    this.client = createEmbeddingClient(DEFAULT_CONFIG);
  }

  setConfig(config: EmbeddingClientConfig): void {
    this.client = createEmbeddingClient(config);
  }

  async embedSingle(value: string): Promise<EmbeddingResult> {
    const result = await this.client.embedSingle(value);
    return { embedding: result.embedding, tokens: result.tokens };
  }

  async embedBatch(values: string[]): Promise<EmbeddingResult[]> {
    const { embeddings, tokens } = await this.client.embedMany(values);
    return embeddings.map((embedding) => ({
      embedding,
      tokens: Math.round(tokens / embeddings.length),
    }));
  }

  async findSimilar(
    query: string,
    candidates: string[],
    options?: { topK?: number },
  ): Promise<EmbeddingSearchResult[]> {
    const allValues = [query, ...candidates];
    const { embeddings } = await this.client.embedMany(allValues);

    const queryEmbedding = embeddings[0];
    const results: EmbeddingSearchResult[] = [];

    for (let i = 1; i < embeddings.length; i++) {
      results.push({
        text: candidates[i - 1],
        score: cosineSimilarity(queryEmbedding, embeddings[i]),
      });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, options?.topK ?? 5);
  }
}
