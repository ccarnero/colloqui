import type { Paginated } from "../../core/pagination.js";
import { paginate, toSinglePage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  CreateMcpServerInput,
  McpServer,
  UpdateMcpServerInput,
} from "./types.js";

export interface McpServersClientDeps {
  transport: Transport;
}

export interface McpServerCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface McpServersClient {
  /** `POST /admin/mcp-servers`. */
  create(
    input: CreateMcpServerInput,
    opts?: McpServerCallOptions
  ): Promise<McpServer>;
  /** `GET /admin/mcp-servers` — bare array (no query params, no pagination), degraded to a single page. */
  list(): Paginated<McpServer>;
  /** `GET /admin/mcp-servers/:id`. */
  get(id: string, opts?: McpServerCallOptions): Promise<McpServer>;
  /** `PUT /admin/mcp-servers/:id` — note: `PUT`, not `PATCH`; see types.ts. */
  update(
    id: string,
    input: UpdateMcpServerInput,
    opts?: McpServerCallOptions
  ): Promise<McpServer>;
  /** `DELETE /admin/mcp-servers/:id`; resolves on 204. */
  remove(id: string, opts?: McpServerCallOptions): Promise<void>;
}

/**
 * Creates the `mcpServers` namespace client. Follows the `workflows`
 * reference implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md
 * "Resource clients".
 */
export function createMcpServersClient({
  transport,
}: McpServersClientDeps): McpServersClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  async function create(
    input: CreateMcpServerInput,
    opts: McpServerCallOptions = {}
  ): Promise<McpServer> {
    const { body } = await transport.request<McpServer>({
      path: "/admin/mcp-servers",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function list(): Paginated<McpServer> {
    return paginate<McpServer>(async () => {
      const { body } = await transport.request<McpServer[]>({
        path: "/admin/mcp-servers",
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function get(
    id: string,
    opts: McpServerCallOptions = {}
  ): Promise<McpServer> {
    const { body } = await transport.request<McpServer>({
      path: `/admin/mcp-servers/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function update(
    id: string,
    input: UpdateMcpServerInput,
    opts: McpServerCallOptions = {}
  ): Promise<McpServer> {
    const { body } = await transport.request<McpServer>({
      path: `/admin/mcp-servers/${encodePath(id)}`,
      method: "PUT",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function remove(
    id: string,
    opts: McpServerCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/admin/mcp-servers/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  return { create, list, get, update, remove };
}
