import type { IChunker, IChunkerConfig, ChunkingStrategy } from "@yoizen/shared";

export class CharacterChunker implements IChunker {
  readonly name: ChunkingStrategy = "character";

  chunk(text: string, config: IChunkerConfig): string[] {
    const chunks: string[] = [];
    const { chunkSize, chunkOverlap } = config;
    const step = Math.max(chunkSize - chunkOverlap, 1);

    for (let start = 0; start < text.length; start += step) {
      const end = Math.min(start + chunkSize, text.length);
      const searchStart = Math.max(start, end - Math.min(200, chunkSize));
      const window_ = text.slice(searchStart, end);

      const lastPeriod = window_.lastIndexOf(".");
      const lastNewline = window_.lastIndexOf("\n");
      const lastQuestion = window_.lastIndexOf("?");
      const lastExclaim = window_.lastIndexOf("!");

      let breakPoint = end;
      const candidates = [
        [lastPeriod, 1],
        [lastNewline, 1],
        [lastQuestion, 1],
        [lastExclaim, 1],
      ];
      for (const [idx, offset] of candidates) {
        if (idx >= 0) {
          breakPoint = searchStart + idx + offset;
          break;
        }
      }

      const chunk = text.slice(start, breakPoint).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }
      start = breakPoint;
      if (start >= end) continue;
    }

    return chunks;
  }
}
