import type { EmbeddingClientConfig, IEmbeddingClient } from "@yoizen/shared";
import { OpenAIEmbeddingClient } from "./openai-embedding.client";

export function createEmbeddingClient(config: EmbeddingClientConfig): IEmbeddingClient {
  switch (config.provider) {
    case "openai":
    default:
      return new OpenAIEmbeddingClient(config);
  }
}
