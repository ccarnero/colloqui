import type { IChunker, IChunkerConfig, ChunkingStrategy } from "@yoizen/shared";

interface TextElement {
  type: "heading" | "paragraph";
  text: string;
  level?: number;
}

interface Section {
  headingPath: string;
  paragraphs: string[];
}

export class TitleSegmentationChunker implements IChunker {
  readonly name: ChunkingStrategy = "title_segmentation";

  chunk(text: string, config: IChunkerConfig): string[] {
    const { chunkSize } = config;
    const elements = this.parseElements(text);
    const sections = this.buildSections(elements);
    const chunks: string[] = [];

    for (const section of sections) {
      const prefix = section.headingPath ? `[${section.headingPath}]\n` : "";
      let currentChunk = prefix;

      for (const paragraph of section.paragraphs) {
        const candidate = currentChunk
          ? `${currentChunk}\n${paragraph}`
          : `${prefix}${paragraph}`;

        if (candidate.length > chunkSize) {
          if (currentChunk.length > prefix.length) {
            chunks.push(currentChunk);
          }
          currentChunk = section.headingPath
            ? `[${section.headingPath}] (cont.)\n${paragraph}`
            : paragraph;
        } else {
          currentChunk = candidate;
        }
      }

      if (currentChunk.length > prefix.length || (prefix.length > 0 && section.paragraphs.length === 0)) {
        chunks.push(currentChunk);
      }
    }

    return chunks;
  }

  private parseElements(text: string): TextElement[] {
    const lines = text.split("\n");
    const elements: TextElement[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        elements.push({
          type: "heading",
          text: headingMatch[2].trim(),
          level: headingMatch[1].length,
        });
      } else if (line.trim()) {
        elements.push({ type: "paragraph", text: line.trim() });
      }
    }

    return elements;
  }

  private buildSections(elements: TextElement[]): Section[] {
    const sections: Section[] = [];
    const headingStack: string[] = [];
    let currentSection: Section | null = null;

    for (const el of elements) {
      if (el.type === "heading" && el.level) {
        while (headingStack.length >= el.level) {
          headingStack.pop();
        }
        headingStack.push(el.text);

        currentSection = {
          headingPath: headingStack.join(" > "),
          paragraphs: [],
        };
        sections.push(currentSection);
      } else if (currentSection) {
        currentSection.paragraphs.push(el.text);
      } else {
        currentSection = { headingPath: "", paragraphs: [el.text] };
        sections.push(currentSection);
      }
    }

    return sections;
  }
}
