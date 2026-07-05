import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { createStructuredKbClient } from "../../../src/resources/structured-kb/client.js";

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

const sampleContainer = {
  id: "skb-1",
  tenant_id: "acme",
  name: "sdk-e2e-fin-kb",
  description: null,
  status: "active" as const,
  version: "1",
  ingest_model: "text-embedding-3-small",
  query_model: "gpt-4o-mini",
  provider_config: {},
  is_active: true,
  created_at: "2026-07-04T00:00:00.000Z",
  updated_at: "2026-07-04T00:00:00.000Z",
};

test("containers.create() POSTs /admin/structured-kb/containers", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleContainer,
  }));
  const client = createStructuredKbClient({ transport });

  const result = await client.containers.create({ name: "sdk-e2e-fin-kb" });
  assert.equal(calls[0]!.path, "/admin/structured-kb/containers");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, sampleContainer);
});

test("containers.list() GETs /admin/structured-kb/containers and degrades to a single page", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: [sampleContainer],
  }));
  const client = createStructuredKbClient({ transport });

  const seen: unknown[] = [];
  for await (const c of client.containers.list()) {
    seen.push(c);
  }
  assert.equal(calls[0]!.path, "/admin/structured-kb/containers");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(seen, [sampleContainer]);
});

test("containers.get() GETs /admin/structured-kb/containers/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleContainer,
  }));
  const client = createStructuredKbClient({ transport });

  const result = await client.containers.get("skb-1");
  assert.equal(calls[0]!.path, "/admin/structured-kb/containers/skb-1");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleContainer);
});

test("containers.update() PATCHes /admin/structured-kb/containers/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleContainer, description: "updated" },
  }));
  const client = createStructuredKbClient({ transport });

  await client.containers.update("skb-1", { description: "updated" });
  assert.equal(calls[0]!.path, "/admin/structured-kb/containers/skb-1");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { description: "updated" });
});

test("containers.remove() DELETEs /admin/structured-kb/containers/:id and resolves with no value", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: {},
  }));
  const client = createStructuredKbClient({ transport });

  const result = await client.containers.remove("skb-1");
  assert.equal(calls[0]!.path, "/admin/structured-kb/containers/skb-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("containers.query() POSTs /admin/structured-kb/containers/:id/query with the input body", async () => {
  const queryResult = {
    results: [{ id: 1, name: "row-1" }],
    sql: "SELECT * FROM t WHERE 1=1",
    totalCount: 1,
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: queryResult,
  }));
  const client = createStructuredKbClient({ transport });

  const result = await client.containers.query("skb-1", {
    query: "show me all rows",
    limit: 10,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/admin/structured-kb/containers/skb-1/query");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, { query: "show me all rows", limit: 10 });
  assert.deepEqual(result, queryResult);
});
