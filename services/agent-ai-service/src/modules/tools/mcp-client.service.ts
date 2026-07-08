import type { MCPClient } from "@ai-sdk/mcp";
import { createMCPClient } from "@ai-sdk/mcp";
import { Injectable, Logger } from "@nestjs/common";
import { agentAiServiceConfig } from "../../config";

export interface McpServerConfig {
  name: string;
  /**
   * `mcp_servers` row id (mcp-connections.md §3) — carried alongside `name`
   * purely so usage-logging call sites (`tool-bridge.service.ts`'s
   * `mergeMcpTools`) can report a real `mcpServerId` instead of only a
   * server name. Not used for connection identity — clients are still keyed
   * by `name` (see {@link connect}).
   */
  id?: string;
  transport:
    | { type: "http"; url: string; headers?: Record<string, string> }
    | { type: "sse"; url: string; headers?: Record<string, string> };
  enabled?: boolean;
}

@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);
  private readonly clients = new Map<string, MCPClient>();
  private readonly serverIds = new Map<string, string>();

  async connect(config: McpServerConfig): Promise<void> {
    if (this.clients.has(config.name)) {
      this.logger.warn(`MCP client '${config.name}' already connected`);
      return;
    }

    try {
      const client = await withTimeout(
        createMCPClient({
          transport: config.transport,
        }),
        agentAiServiceConfig.mcpLiveCallTimeoutMs,
        `MCP connect '${config.name}'`
      );

      this.clients.set(config.name, client);
      if (config.id) {
        this.serverIds.set(config.name, config.id);
      }
      this.logger.log(`Connected to MCP server: ${config.name}`);
    } catch (error) {
      this.logger.error(
        `Failed to connect to MCP server '${config.name}': ${error}`
      );
    }
  }

  /** Resolved `mcp_servers` row id for a connected server name, when known (mcp-connections.md §3). */
  getServerId(name: string): string | undefined {
    return this.serverIds.get(name);
  }

  async getTools(name: string): Promise<Record<string, any>> {
    const client = this.clients.get(name);
    if (!client) {
      this.logger.warn(`MCP client '${name}' not connected`);
      return {};
    }

    try {
      const tools = await withTimeout(
        client.tools(),
        agentAiServiceConfig.mcpLiveCallTimeoutMs,
        `MCP getTools '${name}'`
      );
      return tools as Record<string, any>;
    } catch (error) {
      this.logger.error(
        `Failed to get tools from MCP server '${name}': ${error}`
      );
      return {};
    }
  }

  async getAllTools(): Promise<Record<string, any>> {
    const allTools: Record<string, any> = {};

    for (const [name] of this.clients) {
      const tools = await this.getTools(name);
      Object.assign(allTools, tools);
    }

    return allTools;
  }

  async disconnect(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) {
      return;
    }

    try {
      await client.close();
      this.clients.delete(name);
      this.serverIds.delete(name);
      this.logger.log(`Disconnected from MCP server: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to disconnect MCP server '${name}': ${error}`);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [name] of this.clients) {
      await this.disconnect(name);
    }
  }

  getConnectedServers(): string[] {
    return Array.from(this.clients.keys());
  }
}

/**
 * Races `promise` against a timeout, rejecting with a clear error message
 * on expiry. Mirrors `mcp-call.activity.ts`'s `withTimeout` in
 * `connector-runtime` — that copy guards the Temporal `mcpCall` activity,
 * this one guards the live-chat MCP client (connect, tool discovery, tool
 * execution) so an unresponsive MCP server can't hang the LLM tool-call
 * step indefinitely. Exported so `tool-bridge.service.ts` can reuse it for
 * per-tool-call timeouts.
 */
export function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    clearTimeout(timeoutHandle);
  }) as Promise<T>;
}
