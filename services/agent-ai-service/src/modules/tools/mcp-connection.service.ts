import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { AgentAiTenantConnectionManager } from "../../providers/tenant-connection.manager";
// biome-ignore lint/style/useImportType: NestJS DI requires runtime class reference for constructor injection
import { McpClientService } from "./mcp-client.service";

interface IMcpServerRow {
  id: string;
  tenant_id: string;
  name: string;
  transport_type: "http" | "sse";
  url: string;
  headers: Record<string, string> | null;
  enabled: boolean;
  is_active: boolean;
}

@Injectable()
export class McpConnectionService implements OnModuleInit {
  private readonly logger = new Logger(McpConnectionService.name);

  constructor(
    private readonly mcpClient: McpClientService,
    @Inject(AgentAiTenantConnectionManager)
    private readonly connectionManager: TenantConnectionManager,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connectAllServers();
  }

  async connectAllServers(): Promise<void> {
    try {
      // For now, tenant-specific MCP servers are connected lazily
      // on first request via connectForTenant().
      this.logger.log(
        "MCP connection service initialized (lazy connect per tenant)"
      );
    } catch (error) {
      this.logger.error("Failed to initialize MCP connections", error);
    }
  }

  async connectForTenant(tenantId: string): Promise<void> {
    try {
      const servers = await this.loadEnabledMcpServers(tenantId);
      for (const server of servers) {
        await this.connectServer(server);
      }
      if (servers.length > 0) {
        this.logger.log(
          `Connected to ${servers.length} MCP server(s) for tenant ${tenantId}`
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to connect MCP servers for tenant ${tenantId}`,
        error
      );
    }
  }

  private async loadEnabledMcpServers(
    tenantId: string
  ): Promise<IMcpServerRow[]> {
    try {
      const sql = await (this.connectionManager as any).ensureSchema(tenantId);

      if (sql?.raw) {
        // Postgres
        const rows = await sql<IMcpServerRow[]>`
          SELECT id, tenant_id, name, transport_type, url, headers, enabled, is_active
          FROM mcp_servers
          WHERE enabled = true AND is_active = true
        `;
        return rows ?? [];
      }

      // Fallback: Mongo
      if (sql?.collection) {
        const docs = await sql
          .collection("mcp_servers")
          .find({ enabled: true, is_active: true })
          .toArray();
        return docs.map((doc: any) => ({
          id: String(doc._id),
          tenant_id: doc.tenant_id,
          name: doc.name,
          transport_type: doc.transport_type,
          url: doc.url,
          headers: doc.headers ?? null,
          enabled: doc.enabled,
          is_active: doc.is_active,
        }));
      }
    } catch (error) {
      this.logger.warn(
        `Could not load MCP servers for tenant ${tenantId}: ${error}`
      );
    }
    return [];
  }

  private async connectServer(server: IMcpServerRow): Promise<void> {
    await this.mcpClient.connect({
      name: server.name,
      id: server.id,
      transport: {
        type: server.transport_type,
        url: server.url,
        ...(server.headers ? { headers: server.headers } : {}),
      },
      enabled: true,
    });
  }
}
