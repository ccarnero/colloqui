import { Injectable } from "@nestjs/common";
import type { IChunker, ChunkingStrategy } from "@yoizen/shared";
import { CharacterChunker } from "./character-chunker";
import { RecursiveChunker } from "./recursive-chunker";
import { TitleSegmentationChunker } from "./title-segmentation-chunker";

@Injectable()
export class ChunkerRegistry {
  private readonly chunkers = new Map<ChunkingStrategy, IChunker>();

  constructor(
    characterChunker: CharacterChunker,
    recursiveChunker: RecursiveChunker,
    titleSegmentationChunker: TitleSegmentationChunker,
  ) {
    this.register(characterChunker);
    this.register(recursiveChunker);
    this.register(titleSegmentationChunker);
  }

  getStrategy(name: ChunkingStrategy): IChunker {
    const chunker = this.chunkers.get(name);
    if (!chunker) {
      throw new Error(`Unknown chunking strategy: "${name}". Available: ${[...this.chunkers.keys()].join(", ")}`);
    }
    return chunker;
  }

  private register(chunker: IChunker): void {
    this.chunkers.set(chunker.name, chunker);
  }
}
