import { Injectable, Logger } from "@nestjs/common";
import { createMCPClient } from "@ai-sdk/mcp";
import type { MCPClient } from "@ai-sdk/mcp";

export interface McpServerConfig {
  name: string;
  transport:
    | { type: "http"; url: string; headers?: Record<string, string> }
    | { type: "sse"; url: string; headers?: Record<string, string> };
  enabled?: boolean;
}

@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);
  private readonly clients = new Map<string, MCPClient>();

  async connect(config: McpServerConfig): Promise<void> {
    if (this.clients.has(config.name)) {
      this.logger.warn(`MCP client '${config.name}' already connected`);
      return;
    }

    try {
      const client = await createMCPClient({
        transport: config.transport,
      });

      this.clients.set(config.name, client);
      this.logger.log(`Connected to MCP server: ${config.name}`);
    } catch (error) {
      this.logger.error(
        `Failed to connect to MCP server '${config.name}': ${error}`,
      );
    }
  }

  async getTools(name: string): Promise<Record<string, any>> {
    const client = this.clients.get(name);
    if (!client) {
      this.logger.warn(`MCP client '${name}' not connected`);
      return {};
    }

    try {
      const tools = await client.tools();
      return tools as Record<string, any>;
    } catch (error) {
      this.logger.error(
        `Failed to get tools from MCP server '${name}': ${error}`,
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
    if (!client) return;

    try {
      await client.close();
      this.clients.delete(name);
      this.logger.log(`Disconnected from MCP server: ${name}`);
    } catch (error) {
      this.logger.error(
        `Failed to disconnect MCP server '${name}': ${error}`,
      );
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
