import type { MemoryClientService } from "../../memory/memory-client.service";
import type {
  ToolDef,
  ToolExecutionContext,
  ToolHandler,
  ToolResult,
} from "../tool-definition";

const MAX_OUTPUT_CHARS = 16_384;

/**
 * Builds a truncated list/search envelope whose JSON stays within
 * `MAX_OUTPUT_CHARS`. Capping the item COUNT alone is not enough — a single
 * memory can hold more content than the whole budget — so each surfaced
 * item's `content` is also clamped, and items are dropped until the
 * serialized envelope fits. The LLM is told the results were truncated.
 */
function buildTruncatedListOutput(result: {
  total: number;
  items: readonly unknown[];
}): { total: number; items: unknown[]; truncated: true; message: string } {
  const MAX_ITEMS = 5;
  const PER_ITEM_CONTENT = 500;

  const clampItem = (item: unknown): unknown => {
    if (item && typeof item === "object" && "content" in item) {
      const content = (item as { content?: unknown }).content;
      if (typeof content === "string" && content.length > PER_ITEM_CONTENT) {
        return {
          ...(item as object),
          content: `${content.slice(0, PER_ITEM_CONTENT)}…[truncated]`,
        };
      }
    }
    return item;
  };

  const envelope = (items: unknown[]) => ({
    total: result.total,
    items,
    truncated: true as const,
    message: `Results truncated. ${result.total} total memories found.`,
  });

  const clamped = result.items.slice(0, MAX_ITEMS).map(clampItem);

  // Drop clamped items until the serialized envelope fits the budget.
  for (let count = clamped.length; count >= 0; count--) {
    const candidate = envelope(clamped.slice(0, count));
    if (JSON.stringify(candidate).length <= MAX_OUTPUT_CHARS) {
      return candidate;
    }
  }
  return envelope([]);
}

export function createMemoryToolDef(): ToolDef {
  return {
    name: "memory",
    description:
      "Read, store, search, update, approve, or reject long-term memory. " +
      "Use this to persist and retrieve information across conversations.",
    builtin: true,
    readOnly: false,
    maxOutputChars: MAX_OUTPUT_CHARS,
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "list",
            "search",
            "get",
            "create",
            "update",
            "delete",
            "approve",
            "reject",
          ],
          description: "Action to perform on memory",
        },
        // Fields common to multiple actions
        id: {
          type: "string",
          description:
            "Memory ID (required for get, update, delete, approve, reject)",
        },
        scope: {
          type: "string",
          enum: ["SESSION", "USER", "TENANT"],
          description: "Memory scope (used for create, list)",
        },
        kind: {
          type: "string",
          enum: ["PREFERENCE", "FACT", "NOTICE", "INCIDENT", "PROMO"],
          description: "Memory kind (used for create, list)",
        },
        title: {
          type: "string",
          description: "Memory title (used for create, update)",
        },
        content: {
          type: "string",
          description: "Memory content text (used for create, update)",
        },
        search: {
          type: "string",
          description:
            "Full-text search query (used for list and search actions)",
        },
        status: {
          type: "string",
          enum: [
            "PROPOSED",
            "ACTIVE",
            "PUBLISHED",
            "REJECTED",
            "EXPIRED",
            "ARCHIVED",
          ],
          description: "Filter by status (used for list)",
        },
        topicKey: {
          type: "string",
          description: "Topic key for grouping (used for create, update)",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (used for list)",
        },
        offset: {
          type: "number",
          description: "Result offset for pagination (used for list)",
        },
        metadata: {
          type: "object",
          description: "Custom metadata dictionary (used for create, update)",
        },
      },
      required: ["action"],
    },
  };
}

export function createMemoryHandler(
  memoryClient: MemoryClientService
): ToolHandler {
  return async (
    params: Record<string, unknown>,
    state: ToolExecutionContext
  ): Promise<ToolResult> => {
    const action = String(params.action ?? "")
      .trim()
      .toLowerCase();

    try {
      switch (action) {
        case "list": {
          const result = await memoryClient.list(state.tenantId, {
            scope: String(params.scope ?? "").trim() || undefined,
            kind: String(params.kind ?? "").trim() || undefined,
            status: String(params.status ?? "").trim() || undefined,
            search: String(params.search ?? "").trim() || undefined,
            limit:
              params.limit !== undefined ? Number(params.limit) : undefined,
            offset:
              params.offset !== undefined ? Number(params.offset) : undefined,
            sessionId: state.sessionId,
            userId: state.userId,
          });
          // Truncate output to avoid exceeding maxOutputChars
          if (JSON.stringify(result).length > MAX_OUTPUT_CHARS) {
            return { success: true, output: buildTruncatedListOutput(result) };
          }
          return { success: true, output: result };
        }

        case "search": {
          const searchText = String(params.search ?? "").trim();
          const searchLimit =
            params.limit !== undefined ? Number(params.limit) : 10;
          const result = await memoryClient.search(
            state.tenantId,
            searchText,
            searchLimit
          );
          // Truncate output to avoid exceeding maxOutputChars
          if (JSON.stringify(result).length > MAX_OUTPUT_CHARS) {
            return { success: true, output: buildTruncatedListOutput(result) };
          }
          return { success: true, output: result };
        }

        case "get": {
          const id = String(params.id ?? "").trim();
          if (!id) {
            return {
              success: false,
              output: null,
              error: "id is required for get action",
            };
          }
          const item = await memoryClient.load(state.tenantId, id);
          if (!item) {
            return {
              success: false,
              output: null,
              error: `Memory '${id}' not found`,
            };
          }
          return { success: true, output: item };
        }

        case "create": {
          const scope = String(params.scope ?? "SESSION").trim();
          const kind = String(params.kind ?? "FACT").trim();
          const title = String(params.title ?? "").trim();
          const content = String(params.content ?? "").trim();

          if (!title || !content) {
            return {
              success: false,
              output: null,
              error: "title and content are required for create action",
            };
          }

          const item = await memoryClient.create(state.tenantId, {
            scope,
            kind,
            title,
            content,
            userId: state.userId,
            sessionId: state.sessionId,
            topicKey: String(params.topicKey ?? "").trim() || undefined,
            metadata: params.metadata as Record<string, unknown> | undefined,
          });
          return { success: true, output: item };
        }

        case "update": {
          const updateId = String(params.id ?? "").trim();
          if (!updateId) {
            return {
              success: false,
              output: null,
              error: "id is required for update action",
            };
          }
          const patch: {
            title?: string;
            content?: string;
            metadata?: Record<string, unknown>;
            topicKey?: string;
          } = {};
          if (params.title !== undefined) {
            patch.title = String(params.title).trim();
          }
          if (params.content !== undefined) {
            patch.content = String(params.content).trim();
          }
          if (params.metadata !== undefined) {
            patch.metadata = params.metadata as Record<string, unknown>;
          }
          if (params.topicKey !== undefined) {
            patch.topicKey = String(params.topicKey).trim();
          }

          const updated = await memoryClient.update(
            state.tenantId,
            updateId,
            patch
          );
          return { success: true, output: updated };
        }

        case "delete": {
          const deleteId = String(params.id ?? "").trim();
          if (!deleteId) {
            return {
              success: false,
              output: null,
              error: "id is required for delete action",
            };
          }
          await memoryClient.delete(state.tenantId, deleteId);
          return { success: true, output: { deleted: true, id: deleteId } };
        }

        case "approve": {
          const approveId = String(params.id ?? "").trim();
          if (!approveId) {
            return {
              success: false,
              output: null,
              error: "id is required for approve action",
            };
          }
          const approved = await memoryClient.approve(
            state.tenantId,
            approveId
          );
          return { success: true, output: approved };
        }

        case "reject": {
          const rejectId = String(params.id ?? "").trim();
          if (!rejectId) {
            return {
              success: false,
              output: null,
              error: "id is required for reject action",
            };
          }
          const rejected = await memoryClient.reject(state.tenantId, rejectId);
          return { success: true, output: rejected };
        }

        default:
          return {
            success: false,
            output: null,
            error: `Unknown action '${action}'. Valid actions: list, search, get, create, update, delete, approve, reject`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, output: null, error: message };
    }
  };
}
