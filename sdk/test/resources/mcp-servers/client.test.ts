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
  enabled: true,
  is_active: true,
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

test("update() PUTs (not PATCHes) /admin/mcp-servers/:id with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleServer, name: "renamed" },
  }));
  const client = createMcpServersClient({ transport });

  const result = await client.update("mcp-1", { name: "renamed" });
  assert.equal(calls[0]!.path, "/admin/mcp-servers/mcp-1");
  assert.equal(calls[0]!.method, "PUT");
  assert.deepEqual(calls[0]!.body, { name: "renamed" });
  assert.equal(result.name, "renamed");
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
