import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { createMemoriesClient } from "../../../src/resources/memories/client.js";

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

const sampleMemory = {
  id: "mem-1",
  tenantId: "acme",
  scope: "TENANT" as const,
  kind: "FACT" as const,
  status: "PROPOSED" as const,
  title: "sdk-e2e-fin-memory",
  content: "some content",
  metadata: {},
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z",
};

test("create() POSTs /admin/memories with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleMemory,
  }));
  const client = createMemoriesClient({ transport });

  const result = await client.create({
    scope: "TENANT",
    kind: "FACT",
    title: "sdk-e2e-fin-memory",
    content: "some content",
  });
  assert.equal(calls[0]!.path, "/admin/memories");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, sampleMemory);
});

test("list() GETs /admin/memories with real limit/offset pagination ({items,total})", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { items: [sampleMemory], total: 1 },
  }));
  const client = createMemoriesClient({ transport });

  const seen: unknown[] = [];
  for await (const mem of client.list()) {
    seen.push(mem);
  }
  assert.equal(calls[0]!.path, "/admin/memories?limit=50&offset=0");
  assert.deepEqual(seen, [sampleMemory]);
});

test("list() forwards scope/kind/status/search filters", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { items: [], total: 0 },
  }));
  const client = createMemoriesClient({ transport });

  await client
    .list({ scope: "TENANT", kind: "FACT", status: "PROPOSED", search: "x" })
    .page();
  assert.equal(
    calls[0]!.path,
    "/admin/memories?scope=TENANT&kind=FACT&status=PROPOSED&search=x&limit=50&offset=0"
  );
});

test("listProposals() GETs /admin/memories/proposals", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { items: [sampleMemory], total: 1 },
  }));
  const client = createMemoriesClient({ transport });

  const seen: unknown[] = [];
  for await (const mem of client.listProposals()) {
    seen.push(mem);
  }
  assert.equal(calls[0]!.path, "/admin/memories/proposals?limit=50&offset=0");
  assert.deepEqual(seen, [sampleMemory]);
});

test("get() GETs /admin/memories/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleMemory,
  }));
  const client = createMemoriesClient({ transport });

  const result = await client.get("mem-1");
  assert.equal(calls[0]!.path, "/admin/memories/mem-1");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleMemory);
});

test("update() PATCHes /admin/memories/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleMemory, title: "renamed" },
  }));
  const client = createMemoriesClient({ transport });

  await client.update("mem-1", { title: "renamed" });
  assert.equal(calls[0]!.path, "/admin/memories/mem-1");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { title: "renamed" });
});

test("approve() PATCHes /admin/memories/:id/approve", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleMemory, status: "ACTIVE" },
  }));
  const client = createMemoriesClient({ transport });

  const result = await client.approve("mem-1");
  assert.equal(calls[0]!.path, "/admin/memories/mem-1/approve");
  assert.equal(calls[0]!.method, "PATCH");
  assert.equal(result.status, "ACTIVE");
});

test("reject() PATCHes /admin/memories/:id/reject", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleMemory, status: "REJECTED" },
  }));
  const client = createMemoriesClient({ transport });

  const result = await client.reject("mem-1");
  assert.equal(calls[0]!.path, "/admin/memories/mem-1/reject");
  assert.equal(calls[0]!.method, "PATCH");
  assert.equal(result.status, "REJECTED");
});

test("remove() DELETEs /admin/memories/:id and resolves with no value", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createMemoriesClient({ transport });

  const result = await client.remove("mem-1");
  assert.equal(calls[0]!.path, "/admin/memories/mem-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});
