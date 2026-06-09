import type { LanguageModelMiddleware } from "ai";
import { EmbeddingService } from "./embedding.service";
import { MemoryClientService } from "../memory/memory-client.service";
import type { KnowledgeBaseSearchService } from "../knowledge-bases/knowledge-base-search.service";

export interface RagMiddlewareConfig {
  readonly topK?: number;
  readonly maxContextChars?: number;
  readonly enabled?: boolean;
}

const DEFAULT_CONFIG: Required<RagMiddlewareConfig> = {
  topK: 5,
  maxContextChars: 4000,
  enabled: true,
};

/**
 * Creates a RAG middleware that:
 * 1. Extracts the last user message from the prompt
 * 2. Retrieves relevant context from memory service
 * 3. Appends the context to the user message
 *
 * Usage:
 *   wrapLanguageModel({ model, middleware: [createRagMiddleware(...)] })
 */
export function createRagMiddleware(
  embeddingService: EmbeddingService,
  memoryClient: MemoryClientService,
  config?: RagMiddlewareConfig,
): LanguageModelMiddleware {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (cfg.enabled === false) {
    return { specificationVersion: "v3" };
  }

  return {
    specificationVersion: "v3",
    transformParams: async ({ params }) => {
      return enhanceWithRagContext(params, memoryClient, cfg);
    },
  };
}

async function enhanceWithRagContext(
  params: any,
  memoryClient: MemoryClientService,
  config: Required<RagMiddlewareConfig>,
): Promise<any> {
  try {
    // Extract last user message from prompt
    const lastUserMessage = extractLastUserMessage(params.prompt);
    if (!lastUserMessage) return params;

    // Use text search from memory service (embedding-based search can be added later)
    const searchResult = await memoryClient.search(
      (params as any).tenantId ?? "default",
      lastUserMessage,
      config.topK,
    );

    const items = searchResult.items ?? [];
    if (items.length === 0) return params;

    // Build context string
    let contextStr = "";
    let runningLength = 0;
    const topItems = items.slice(0, config.topK);
    for (let i = 0; i < topItems.length; i++) {
      const section = `[${i + 1}] ${topItems[i].title}: ${topItems[i].content}`;
      const nextLen = runningLength + section.length + (contextStr ? 1 : 0);
      if (nextLen > config.maxContextChars) break;
      contextStr += (contextStr ? "\n" : "") + section;
      runningLength = nextLen;
    }
    if (!contextStr && items.length > 0) {
      const first = `[1] ${items[0].title}: ${items[0].content}`;
      contextStr = first.slice(0, config.maxContextChars) + "\n[...truncated]";
    }

    // Append to the last user message
    return appendToLastUserMessage(params, `\n\n---\nRelevant context:\n${contextStr}`);
  } catch {
    // RAG failure should not break the LLM call
    return params;
  }
}

function extractLastUserMessage(prompt: any): string | null {
  if (typeof prompt === "string") return prompt;

  // Handle message array format
  if (Array.isArray(prompt)) {
    for (let i = prompt.length - 1; i >= 0; i--) {
      const msg = prompt[i];
      if (msg?.role === "user") {
        return typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join(" ")
            : null;
      }
    }
  }

  return null;
}

function appendToLastUserMessage(params: any, text: string): any {
  if (typeof params.prompt === "string") {
    return { ...params, prompt: params.prompt + text };
  }

  if (Array.isArray(params.prompt)) {
    const messages = [...params.prompt];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") {
        const msg = { ...messages[i] };
        if (typeof msg.content === "string") {
          msg.content = msg.content + text;
        }
        messages[i] = msg;
        break;
      }
    }
    return { ...params, prompt: messages };
  }

  return params;
}

/**
 * Creates a RAG middleware that searches the agent's associated knowledge bases.
 */
export function createKnowledgeBaseRagMiddleware(
  knowledgeBaseSearch: KnowledgeBaseSearchService,
  tenantId: string,
  kbIds: string[],
  config?: RagMiddlewareConfig,
): LanguageModelMiddleware {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (cfg.enabled === false || kbIds.length === 0) {
    return { specificationVersion: "v3" };
  }

  return {
    specificationVersion: "v3",
    transformParams: async ({ params }) => {
      try {
        const lastUserMessage = extractLastUserMessage(params.prompt);
        if (!lastUserMessage) return params;

        const results = await knowledgeBaseSearch.search(
          tenantId,
          kbIds,
          lastUserMessage,
          { topK: cfg.topK },
        );
        if (results.length === 0) return params;

        let contextStr = "";
        let runningLength = 0;
        for (let i = 0; i < results.length; i++) {
          const section = `[${i + 1}] ${results[i].content}`;
          const nextLen = runningLength + section.length + (contextStr ? 2 : 0);
          if (nextLen > cfg.maxContextChars) break;
          contextStr += (contextStr ? "\n\n" : "") + section;
          runningLength = nextLen;
        }
        if (!contextStr && results.length > 0) {
          const first = `[1] ${results[0].content}`;
          contextStr = first.slice(0, cfg.maxContextChars) + "\n\n[...truncated]";
        }

        return appendToLastUserMessage(
          params,
          `\n\n---\nRelevant knowledge base context:\n${contextStr}\n---`,
        );
      } catch {
        return params;
      }
    },
  };
}
