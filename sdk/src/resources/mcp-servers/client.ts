import type { Paginated } from "../../core/pagination.js";
import { paginate, toSinglePage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  CreateMcpServerInput,
  McpServer,
  McpServerTestConnectionResult,
  McpServerTool,
  McpServerUsage,
  McpServerUsageParams,
  UpdateMcpServerInput,
} from "./types.js";

function toUsageQuery(params: McpServerUsageParams): string {
  return params.window === undefined ? "" : `?window=${params.window}`;
}

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
  /** `PATCH /admin/mcp-servers/:id`; see types.ts. */
  update(
    id: string,
    input: UpdateMcpServerInput,
    opts?: McpServerCallOptions
  ): Promise<McpServer>;
  /** `DELETE /admin/mcp-servers/:id`; resolves on 204. */
  remove(id: string, opts?: McpServerCallOptions): Promise<void>;
  /** `GET /admin/mcp-servers/:id/tools` — live `tools/list` probe against the MCP server. */
  listTools(id: string, opts?: McpServerCallOptions): Promise<McpServerTool[]>;
  /** `POST /admin/mcp-servers/:id/test` — live connectivity probe, no request body, no persistence side-effect. */
  testConnection(
    id: string,
    opts?: McpServerCallOptions
  ): Promise<McpServerTestConnectionResult>;
  /**
   * `GET /admin/mcp-servers/:id/usage` — usage summary + recent calls for the
   * MCP detail page (mcp-connections.md §3, §6.3), mirroring
   * `connectors.usage()`'s response shape. `window` is a day count; falls
   * back to the service's default (7) when omitted.
   */
  getUsage(
    id: string,
    params?: McpServerUsageParams,
    opts?: McpServerCallOptions
  ): Promise<McpServerUsage>;
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
      method: "PATCH",
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

  async function listTools(
    id: string,
    opts: McpServerCallOptions = {}
  ): Promise<McpServerTool[]> {
    const { body } = await transport.request<McpServerTool[]>({
      path: `/admin/mcp-servers/${encodePath(id)}/tools`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function testConnection(
    id: string,
    opts: McpServerCallOptions = {}
  ): Promise<McpServerTestConnectionResult> {
    const { body } = await transport.request<McpServerTestConnectionResult>({
      path: `/admin/mcp-servers/${encodePath(id)}/test`,
      method: "POST",
      retry: opts.retry,
    });
    return body;
  }

  async function getUsage(
    id: string,
    params: McpServerUsageParams = {},
    opts: McpServerCallOptions = {}
  ): Promise<McpServerUsage> {
    const { body } = await transport.request<McpServerUsage>({
      path: `/admin/mcp-servers/${encodePath(id)}/usage${toUsageQuery(params)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  return {
    create,
    list,
    get,
    update,
    remove,
    listTools,
    testConnection,
    getUsage,
  };
}
