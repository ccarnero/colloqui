export type ChunkingStrategy = "character" | "recursive" | "semantic" | "title_segmentation";

export interface IChunkerConfig {
  chunkSize: number;
  chunkOverlap: number;
  strategy: ChunkingStrategy;
}

export interface IChunker {
  readonly name: ChunkingStrategy;
  chunk(text: string, config: IChunkerConfig): string[];
}
