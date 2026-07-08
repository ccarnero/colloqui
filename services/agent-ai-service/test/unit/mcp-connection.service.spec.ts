import { describe, expect, it, mock } from "bun:test";
import { McpConnectionService } from "../../src/modules/tools/mcp-connection.service";

/**
 * Regression coverage for the tenant-DB detection inside
 * `loadEnabledMcpServers`. A postgres.js client is a callable tagged-template
 * function with no `.raw` property — the old `sql?.raw` probe classified
 * every Postgres tenant as "neither Postgres nor Mongo" and silently returned
 * no servers, so tenant MCP servers were never connected on the Postgres
 * path.
 */

const SERVER_ROW = {
  id: "srv-1",
  tenant_id: "acme",
  name: "deepwiki",
  transport_type: "http" as const,
  url: "https://mcp.example.com/mcp",
  headers: null,
  enabled: true,
  is_active: true,
  scope: "external" as const,
};

function buildService(sqlLike: unknown) {
  const mcpClient = { connect: mock(async () => {}) };
  const connectionManager = { ensureSchema: mock(async () => sqlLike) };
  const service = new McpConnectionService(
    mcpClient as never,
    connectionManager as never
  );
  return { service, mcpClient, connectionManager };
}

describe("McpConnectionService.connectForTenant — tenant DB detection", () => {
  it("loads servers through a postgres.js-style callable client and connects each", async () => {
    // postgres.js clients are tagged-template functions: sql`SELECT ...`
    const sql = mock(async () => [SERVER_ROW]);

    const { service, mcpClient } = buildService(sql);
    await service.connectForTenant("acme");

    expect(sql).toHaveBeenCalledTimes(1);
    expect(mcpClient.connect).toHaveBeenCalledTimes(1);
    expect(mcpClient.connect.mock.calls[0]?.[0]).toMatchObject({
      name: "deepwiki",
      id: "srv-1",
      enabled: true,
      scope: "external",
      transport: { type: "http", url: "https://mcp.example.com/mcp" },
    });
  });

  it("loads servers through a Mongo-style handle exposing collection()", async () => {
    const find = mock(() => ({
      toArray: async () => [
        {
          _id: "srv-2",
          tenant_id: "acme",
          name: "mongo-server",
          transport_type: "http",
          url: "https://mcp.example.com/mongo",
          headers: null,
          enabled: true,
          is_active: true,
        },
      ],
    }));
    const db = { collection: mock(() => ({ find })) };

    const { service, mcpClient } = buildService(db);
    await service.connectForTenant("acme");

    expect(db.collection).toHaveBeenCalledWith("mcp_servers");
    expect(mcpClient.connect).toHaveBeenCalledTimes(1);
    expect(mcpClient.connect.mock.calls[0]?.[0]).toMatchObject({
      name: "mongo-server",
      id: "srv-2",
      scope: "external",
    });
  });

  it("connects nothing when the handle is neither callable nor Mongo-like", async () => {
    const { service, mcpClient } = buildService({});
    await service.connectForTenant("acme");

    expect(mcpClient.connect).not.toHaveBeenCalled();
  });
});
