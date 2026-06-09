import { Injectable, Logger } from "@nestjs/common";
import { MemoryClientService } from "./memory-client.service";

export interface MemoryContext {
  summary: string;
  items: Array<{
    title: string;
    content: string;
  }>;
  raw: Record<string, unknown>;
}

const EMPTY_CONTEXT: MemoryContext = { summary: "", items: [], raw: {} };

@Injectable()
export class MemoryContextBuilderService {
  private readonly logger = new Logger(MemoryContextBuilderService.name);

  constructor(private readonly memoryClient: MemoryClientService) {}

  async buildContext(
    tenantId: string,
    agentId: string,
    message: string,
  ): Promise<MemoryContext> {
    try {
      const result = await this.memoryClient.search(tenantId, message, 10);
      const items = (result.items ?? []).map((m) => ({
        title: m.title,
        content: m.content,
      }));

      const summary = items
        .slice(0, 5)
        .map((i) => i.content)
        .join("; ");

      return { summary, items, raw: { tenant: { summary, items } } };
    } catch (error) {
      this.logger.warn(
        `Failed to build memory context for tenant=${tenantId} agent=${agentId}: ${error}`,
      );
      return EMPTY_CONTEXT;
    }
  }

  formatForPrompt(context: MemoryContext): string {
    const sections: string[] = [];

    if (context.summary) {
      sections.push(`Tenant memory summary:\n${context.summary}`);
    }

    if (context.items.length > 0) {
      const lines = context.items
        .slice(0, 10)
        .map((item) => {
          if (item.content) {
            return `- ${item.title}: ${item.content}`;
          }
          return `- ${item.title}`;
        });
      sections.push(`Tenant memories:\n${lines.join("\n")}`);
    }

    return sections.join("\n\n").trim();
  }
}
