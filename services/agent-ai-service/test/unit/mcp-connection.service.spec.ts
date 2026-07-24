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

/**
 * T02 (agent-mcp-tool-naming.md) — agent-level MCP scoping.
 *
 * `connectForTenant` gains an optional `enabledMcpServers` parameter so the
 * SAME existing call sites/tests above (tenantId-only) keep compiling and
 * behaving unchanged (decision 3: `null`/omitted = allow-all, unchanged
 * default). A non-empty array scopes the connect to only those named
 * servers (Postgres `WHERE name = ANY($1)` / Mongo `$in`, reusing the
 * existing dual-path shape — no new branch kind). An explicit empty array
 * short-circuits to zero connect calls, with no query issued at all.
 */
const SERVER_ROW_B = {
  id: "srv-2",
  tenant_id: "acme",
  name: "sample-mcp-server",
  transport_type: "http" as const,
  url: "https://mcp.example.com/sample",
  headers: null,
  enabled: true,
  is_active: true,
  scope: "external" as const,
};

describe("McpConnectionService.connectForTenant — agent scoping (enabledMcpServers)", () => {
  it("enabledMcpServers == null connects every enabled+active tenant server (unchanged default)", async () => {
    const sql = mock(async () => [SERVER_ROW, SERVER_ROW_B]);
    const { service, mcpClient } = buildService(sql);

    await service.connectForTenant("acme", null);

    expect(sql).toHaveBeenCalledTimes(1);
    expect(mcpClient.connect).toHaveBeenCalledTimes(2);
    const connectedNames = mcpClient.connect.mock.calls.map(
      (call) => (call[0] as { name: string }).name
    );
    expect(connectedNames.sort()).toEqual(
      ["deepwiki", "sample-mcp-server"].sort()
    );
  });

  it('enabledMcpServers = ["serverA"] connects only serverA, even when other enabled+active servers exist', async () => {
    // The query itself is scoped (WHERE name = ANY / $in) — simulate the
    // Postgres client honoring the filter by returning only the matching row.
    const sql = mock(async () => [SERVER_ROW]);
    const { service, mcpClient } = buildService(sql);

    await service.connectForTenant("acme", ["deepwiki"]);

    expect(sql).toHaveBeenCalledTimes(1);
    expect(mcpClient.connect).toHaveBeenCalledTimes(1);
    expect(mcpClient.connect.mock.calls[0]?.[0]).toMatchObject({
      name: "deepwiki",
    });
  });

  it("enabledMcpServers = [] makes zero connect calls at all (no query issued)", async () => {
    const sql = mock(async () => [SERVER_ROW, SERVER_ROW_B]);
    const { service, mcpClient } = buildService(sql);

    await service.connectForTenant("acme", []);

    expect(sql).not.toHaveBeenCalled();
    expect(mcpClient.connect).not.toHaveBeenCalled();
  });

  it("scopes the Mongo path with $in the same way as the Postgres ANY path", async () => {
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

    await service.connectForTenant("acme", ["mongo-server"]);

    expect(find).toHaveBeenCalledWith({
      enabled: true,
      is_active: true,
      name: { $in: ["mongo-server"] },
    });
    expect(mcpClient.connect).toHaveBeenCalledTimes(1);
  });

  it("cross-agent isolation: an agent scoped to serverA never receives serverB's tools merged in", async () => {
    // Two independent chat turns for two agents with disjoint MCP scopes,
    // running against the same tenant DB handle — the exact "reachable
    // server injects tools into unrelated agents" failure mode from the
    // incident, expressed at the connection layer. This mock simulates a
    // real `WHERE name = ANY($1)` filter by honoring the interpolated
    // scoped-names array, instead of always returning every row.
    const allRows = [SERVER_ROW, SERVER_ROW_B];
    const sql = mock(
      async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        const scopedNames = values[0] as string[] | undefined;
        if (!scopedNames) {
          return allRows;
        }
        return allRows.filter((row) => scopedNames.includes(row.name));
      }
    );
    const { service, mcpClient } = buildService(sql);

    await service.connectForTenant("acme", ["deepwiki"]);
    const agentAConnectedNames = mcpClient.connect.mock.calls.map(
      (call) => (call[0] as { name: string }).name
    );

    mcpClient.connect.mockClear();

    await service.connectForTenant("acme", ["sample-mcp-server"]);
    const agentBConnectedNames = mcpClient.connect.mock.calls.map(
      (call) => (call[0] as { name: string }).name
    );

    expect(agentAConnectedNames).not.toContain("sample-mcp-server");
    expect(agentBConnectedNames).not.toContain("deepwiki");
  });
});
