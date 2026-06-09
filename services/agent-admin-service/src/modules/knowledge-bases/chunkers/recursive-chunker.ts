import type { IChunker, IChunkerConfig, ChunkingStrategy } from "@yoizen/shared";

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", " "];

export class RecursiveChunker implements IChunker {
  readonly name: ChunkingStrategy = "recursive";

  chunk(text: string, config: IChunkerConfig): string[] {
    const chunks: string[] = [];
    const { chunkSize, chunkOverlap } = config;

    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + chunkSize, text.length);

      if (end < text.length) {
        end = this.findBreakPoint(text, start, end);
      }

      const chunk = text.slice(start, end).trim();
      if (chunk.length > 20) {
        chunks.push(chunk);
      }

      const nextStart = Math.max(end - chunkOverlap, start + 1);
      if (nextStart <= start) break;
      start = nextStart;
    }

    return chunks;
  }

  private findBreakPoint(text: string, start: number, end: number): number {
    const searchWindow = text.slice(Math.max(start, end - 200), end);

    for (const sep of DEFAULT_SEPARATORS) {
      const idx = searchWindow.lastIndexOf(sep);
      if (idx >= 0) {
        return Math.max(start, end - searchWindow.length + idx + sep.length);
      }
    }

    return end;
  }
}
