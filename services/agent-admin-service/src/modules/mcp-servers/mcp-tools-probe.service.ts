import { createMCPClient } from "@ai-sdk/mcp";
import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { IMcpServer } from "./mcp-servers.repository.interface";

/** Response shape for `GET admin/mcp-servers/:id/tools` (mcp-connections.md §2.4). */
export interface IMcpToolSummary {
  name: string;
  description: string | null;
  inputSchema: unknown;
}

/** Response shape for `POST admin/mcp-servers/:id/test` (mcp-connections.md §2.2). */
export interface IMcpTestConnectionResult {
  success: boolean;
  latencyMs: number;
  toolCount?: number;
  error?: string;
}

/** Bounded wait for a transient tools/list probe — same order of magnitude as the adapter test-connection budget (mcp-connections.md §2.2). */
const TOOLS_LIST_TIMEOUT_MS = 8000;

/** Bounded wait for a transient test-connection probe (mcp-connections.md §2.2: "~5s timeout"). */
const TEST_CONNECTION_TIMEOUT_MS = 5000;

/**
 * Connects transiently to an MCP server to fetch its exposed tools
 * (mcp-connections.md §2.4). No persistence side-effect, no pooled
 * connection — every call connects, lists, and disconnects. This is
 * deliberately separate from `agent-ai-service`'s
 * `mcp-connection.service.ts`, which maintains long-lived per-tenant
 * connections for actual tool execution at chat time; this probe only
 * powers admin-facing read screens (MCP detail's Tools section, the agent
 * editor's per-tool picker, the workflow builder's Tool dropdown), so a
 * fresh short-lived connection per call is the simpler, safer choice —
 * agent-admin-service has no reason to hold a live MCP connection open.
 */
@Injectable()
export class McpToolsProbeService {
  private readonly logger = new PinoLoggerService(McpToolsProbeService.name);

  async listTools(server: IMcpServer): Promise<IMcpToolSummary[]> {
    const client = await this.connect(server, TOOLS_LIST_TIMEOUT_MS);
    try {
      const tools = await this.withTimeout(
        client.tools(),
        TOOLS_LIST_TIMEOUT_MS
      );
      return this.mapTools(tools);
    } finally {
      await this.closeQuietly(client, server.id);
    }
  }

  /**
   * Live connectivity probe (mcp-connections.md §2.2). No persistence
   * side-effect — `is_active` stays an explicit admin toggle, never derived
   * from this result. For `transport_type: "http"` this also does a single
   * `tools/list` call (cheap, and gives us `toolCount` for free) — for
   * `transport_type: "sse"` we deliberately stop at "handshake opened",
   * per spec, without an extra round trip.
   */
  async testConnection(server: IMcpServer): Promise<IMcpTestConnectionResult> {
    const start = Date.now();
    let client: Awaited<ReturnType<typeof createMCPClient>> | undefined;
    try {
      client = await this.connect(server, TEST_CONNECTION_TIMEOUT_MS);
      let toolCount: number | undefined;
      if (server.transport_type === "http") {
        const tools = await this.withTimeout(
          client.tools(),
          TEST_CONNECTION_TIMEOUT_MS
        );
        toolCount = Object.keys(tools).length;
      }
      return { success: true, latencyMs: Date.now() - start, toolCount };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (client) {
        await this.closeQuietly(client, server.id);
      }
    }
  }

  /**
   * Shared connection helper for {@link listTools} and {@link testConnection}
   * — validates the URL (SSRF guard), builds auth headers, and opens the
   * transient MCP client, bounded by `timeoutMs`. Extracted so both callers
   * share one connection path instead of duplicating transport/auth wiring
   * (mcp-connections.md §2.2 calls for reusing this same probe pattern).
   */
  private async connect(
    server: IMcpServer,
    timeoutMs: number
  ): Promise<Awaited<ReturnType<typeof createMCPClient>>> {
    this.validateUrl(server.url);
    const headers = this.buildHeaders(server);
    return this.withTimeout(
      createMCPClient({
        transport:
          server.transport_type === "sse"
            ? { type: "sse", url: server.url, headers }
            : { type: "http", url: server.url, headers },
      }),
      timeoutMs
    );
  }

  private async closeQuietly(
    client: Awaited<ReturnType<typeof createMCPClient>>,
    serverId: string
  ): Promise<void> {
    try {
      await client.close();
    } catch (error) {
      this.logger.warn(
        `Failed to close transient MCP probe connection for '${serverId}': ${error}`
      );
    }
  }

  private mapTools(tools: Record<string, unknown>): IMcpToolSummary[] {
    return Object.entries(tools).map(([name, def]) => {
      const record = (def ?? {}) as Record<string, unknown>;
      return {
        name,
        description:
          typeof record.description === "string" ? record.description : null,
        inputSchema: record.inputSchema ?? record.parameters ?? null,
      };
    });
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () =>
          reject(new Error(`MCP tools/list timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timeoutHandle!);
    }
  }

  /**
   * Injects auth headers per `auth_type`, same shape as
   * `adapter-executor.service.ts`'s `injectAuthHeaders` (minus
   * `oauth2-client`, an explicit non-goal for MCP servers in this phase).
   */
  private buildHeaders(server: IMcpServer): Record<string, string> {
    const headers: Record<string, string> = { ...(server.headers ?? {}) };
    const authConfig = server.auth_config ?? {};

    switch (server.auth_type) {
      case "api-key": {
        const headerName = (authConfig.headerName as string) ?? "X-Api-Key";
        const key = authConfig.key as string;
        if (key && !(headerName in headers)) {
          headers[headerName] = key;
        }
        break;
      }
      case "bearer": {
        const token = (authConfig.token as string) ?? "";
        if (token && !("Authorization" in headers)) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        break;
      }
      case "basic": {
        const username = authConfig.username as string;
        const password = authConfig.password as string;
        if (username && !("Authorization" in headers)) {
          const credentials = Buffer.from(`${username}:${password}`).toString(
            "base64"
          );
          headers["Authorization"] = `Basic ${credentials}`;
        }
        break;
      }
      case "none":
      default:
        break;
    }

    return headers;
  }

  /** SSRF guard — ported verbatim from `adapter-executor.service.ts`'s `validateUrl`. */
  private validateUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid MCP server URL: '${url}'`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `MCP server URL must use http or https protocol: '${url}'`
      );
    }

    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      throw new Error("MCP server URL must not target localhost");
    }

    if (hostname === "169.254.169.254") {
      throw new Error("MCP server URL must not target cloud metadata endpoint");
    }

    if (hostname.startsWith("169.254.") || hostname.startsWith("fe80:")) {
      throw new Error("MCP server URL must not target link-local addresses");
    }

    const parts = hostname.split(".");

    if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
      const octets = parts.map(Number);

      if (
        octets[0] === 10 ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168)
      ) {
        throw new Error(
          "MCP server URL must not target private/RFC1918 addresses"
        );
      }
    }
  }
}
