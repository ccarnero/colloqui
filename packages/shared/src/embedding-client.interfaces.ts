export interface EmbeddingClientConfig {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  apiVersion?: string;
  dimensions?: number;
}

export interface IEmbeddingClient {
  readonly provider: string;
  embedSingle(value: string): Promise<{ embedding: number[]; tokens: number }>;
  embedMany(values: string[]): Promise<{ embeddings: number[][]; tokens: number }>;
}
