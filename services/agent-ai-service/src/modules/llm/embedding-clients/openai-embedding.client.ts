import { embed, embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { IEmbeddingClient, EmbeddingClientConfig } from "@yoizen/shared";

export class OpenAIEmbeddingClient implements IEmbeddingClient {
  readonly provider = "openai";
  private readonly modelName = "text-embedding-3-small";
  private readonly providerInstance: ReturnType<typeof createOpenAI>;

  constructor(config: EmbeddingClientConfig) {
    this.providerInstance = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async embedSingle(value: string): Promise<{ embedding: number[]; tokens: number }> {
    const { embedding: emb, usage } = await embed({
      model: this.providerInstance.embedding(this.modelName),
      value,
    });
    return { embedding: emb, tokens: usage.tokens };
  }

  async embedMany(values: string[]): Promise<{ embeddings: number[][]; tokens: number }> {
    const { embeddings, usage } = await embedMany({
      model: this.providerInstance.embedding(this.modelName),
      values,
    });
    return { embeddings, tokens: usage.tokens };
  }
}
