import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { NotFoundError } from "../../../src/domain/errors.js";
import { createMcpServersClient } from "../../../src/resources/mcp-servers/client.js";

interface Call extends TransportRequestOptions {}

function fakeTransport(
  handler: (
    call: Call
  ) => TransportResponse<unknown> | Promise<TransportResponse<unknown>>
): { transport: Transport; calls: Call[] } {
  const calls: Call[] = [];
  const transport: Transport = {
    async request(options) {
      calls.push(options);
      return (await handler(options)) as TransportResponse<never>;
    },
  };
  return { transport, calls };
}

const sampleServer = {
  id: "mcp-1",
  tenant_id: "acme",
  name: "SDK test MCP server",
  description: null,
  transport_type: "http" as const,
  url: "https://example.com/mcp",
  headers: null,
  authType: "none" as const,
  authConfig: null,
  enabled: true,
  is_active: true,
  managedBy: null,
  managedLockedFields: null,
  created_at: "2026-07-04T00:00:00.000Z",
  updated_at: "2026-07-04T00:00:00.000Z",
};

test("create() POSTs /admin/mcp-servers with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleServer,
  }));
  const client = createMcpServersClient({ transport });

  const result = await client.create({
    name: "SDK test MCP server",
    transport_type: "http",
    url: "https://example.com/mcp",
  });

  assert.equal(calls[0]!.path, "/admin/mcp-servers");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, sampleServer);
});

test("list() GETs /admin/mcp-servers and degrades the bare array to a single page", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: [sampleServer],
  }));
  const client = createMcpServersClient({ transport });

  const seen: unknown[] = [];
  for await (const server of client.list()) {
    seen.push(server);
  }

  assert.equal(calls[0]!.path, "/admin/mcp-servers");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(seen, [sampleServer]);
});

test("get() GETs /admin/mcp-servers/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleServer,
  }));
  const client = createMcpServersClient({ transport });

  const result = await client.get("mcp-1");
  assert.equal(calls[0]!.path, "/admin/mcp-servers/mcp-1");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleServer);
});

test("get() propagates transport errors unchanged (error-mapping passthrough — real 404s here, unlike knowledgeBases/skills/systemVariables)", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createMcpServersClient({ transport });

  await assert.rejects(() => client.get("missing"), NotFoundError);
});

test("update() PATCHes /admin/mcp-servers/:id with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleServer, name: "renamed" },
  }));
  const client = createMcpServersClient({ transport });

  const result = await client.update("mcp-1", { name: "renamed" });
  assert.equal(calls[0]!.path, "/admin/mcp-servers/mcp-1");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { name: "renamed" });
  assert.equal(result.name, "renamed");
});

test("listTools() GETs /admin/mcp-servers/:id/tools", async () => {
  const sampleTools = [
    {
      name: "search",
      description: "Search the web",
      inputSchema: { type: "object" },
    },
  ];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleTools,
  }));
  const client = createMcpServersClient({ transport });

  const result = await client.listTools("mcp-1");
  assert.equal(calls[0]!.path, "/admin/mcp-servers/mcp-1/tools");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleTools);
});

test("testConnection() POSTs /admin/mcp-servers/:id/test with no body", async () => {
  const result = { success: true, latencyMs: 42, toolCount: 3 };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: result,
  }));
  const client = createMcpServersClient({ transport });

  const response = await client.testConnection("mcp-1");
  assert.equal(calls[0]!.path, "/admin/mcp-servers/mcp-1/test");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(response, result);
});

test("getUsage() GETs /admin/mcp-servers/:id/usage with no query params by default", async () => {
  const usage = {
    windowDays: 7,
    summary: {
      totalCalls: 10,
      successCalls: 9,
      errorCalls: 1,
      avgDurationMs: 120,
    },
    recentCalls: [
      {
        toolName: "search",
        success: true,
        durationMs: 100,
        error: null,
        createdAt: "2026-07-08T00:00:00.000Z",
      },
    ],
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: usage,
  }));
  const client = createMcpServersClient({ transport });

  const result = await client.getUsage("mcp-1");
  assert.equal(calls[0]!.path, "/admin/mcp-servers/mcp-1/usage");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, usage);
});

test("getUsage() forwards the window param as a query string", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: {
      windowDays: 30,
      summary: {
        totalCalls: 0,
        successCalls: 0,
        errorCalls: 0,
        avgDurationMs: 0,
      },
      recentCalls: [],
    },
  }));
  const client = createMcpServersClient({ transport });

  await client.getUsage("mcp-1", { window: 30 });
  assert.equal(calls[0]!.path, "/admin/mcp-servers/mcp-1/usage?window=30");
});

test("remove() DELETEs /admin/mcp-servers/:id and resolves with no value", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createMcpServersClient({ transport });

  const result = await client.remove("mcp-1");
  assert.equal(calls[0]!.path, "/admin/mcp-servers/mcp-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});
