import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { ConflictError } from "../../../src/domain/errors.js";
import { createConnectorsClient } from "../../../src/resources/connectors/client.js";

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

const sampleConnector = {
  id: "conn-1",
  tenantId: "acme",
  name: "jsonplaceholder",
  context: "external" as const,
  baseUrl: "https://jsonplaceholder.typicode.com",
  authType: "none",
  authConfig: {},
  headers: [],
  defaultCache: null,
  timeoutMs: 10000,
  maxRetries: 2,
  retryBackoffMs: 300,
  healthCheckPath: "/posts/1",
  status: "enabled",
  isEncrypted: false,
  tags: ["sample"],
  managedBy: null,
  endpoints: [],
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z",
};

test("create() POSTs /connectors with the input body and returns the created connector", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleConnector,
  }));
  const client = createConnectorsClient({ transport });

  const result = await client.create({
    name: "jsonplaceholder",
    context: "external",
    baseUrl: "https://jsonplaceholder.typicode.com",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/connectors");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, sampleConnector);
});

test("list() GETs /connectors and degrades the bare array to a single page", async () => {
  const items = [sampleConnector];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: items,
  }));
  const client = createConnectorsClient({ transport });

  const seen: unknown[] = [];
  for await (const conn of client.list()) {
    seen.push(conn);
  }

  assert.equal(calls[0]!.path, "/connectors");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(seen, items);
});

test("list() forwards context and tag as query params", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: [],
  }));
  const client = createConnectorsClient({ transport });

  await client.list({ context: "external", tag: "sample" }).page();
  assert.equal(calls[0]!.path, "/connectors?context=external&tag=sample");
});

test("usage() GETs /connectors/usage with the window query param", async () => {
  const usageResult = {
    windowDays: 7,
    topByCallCount: [
      {
        adapterId: "conn-1",
        totalCalls: 10,
        successCalls: 9,
        errorCalls: 1,
        avgDurationMs: 120,
        cacheHits: 3,
      },
    ],
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: usageResult,
  }));
  const client = createConnectorsClient({ transport });

  const result = await client.usage({ window: 7 });
  assert.equal(calls[0]!.path, "/connectors/usage?window=7");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, usageResult);
});

test("usage() omits the query string when no window is passed", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { windowDays: 7, topByCallCount: [] },
  }));
  const client = createConnectorsClient({ transport });

  await client.usage();
  assert.equal(calls[0]!.path, "/connectors/usage");
});

test("get() GETs /connectors/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleConnector,
  }));
  const client = createConnectorsClient({ transport });

  const result = await client.get("conn-1");
  assert.equal(calls[0]!.path, "/connectors/conn-1");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleConnector);
});

test("update() PATCHes /connectors/:id with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleConnector, name: "renamed" },
  }));
  const client = createConnectorsClient({ transport });

  await client.update("conn-1", { name: "renamed" });
  assert.equal(calls[0]!.path, "/connectors/conn-1");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { name: "renamed" });
});

test("update() propagates ConflictError for a registry-managed adapter (error-mapping passthrough)", async () => {
  const { transport } = fakeTransport(() => {
    throw new ConflictError("request failed: conflict");
  });
  const client = createConnectorsClient({ transport });

  await assert.rejects(
    () => client.update("conn-1", { name: "x" }),
    ConflictError
  );
});

test("update() URL-encodes the connector id in the path", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleConnector,
  }));
  const client = createConnectorsClient({ transport });
  await client.update("conn/needs encoding", { name: "x" });
  assert.equal(calls[0]!.path, "/connectors/conn%2Fneeds%20encoding");
});

test("remove() DELETEs /connectors/:id and resolves with no value", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createConnectorsClient({ transport });

  const result = await client.remove("conn-1");
  assert.equal(calls[0]!.path, "/connectors/conn-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("addEndpoint() POSTs /connectors/:id/endpoints with the input body", async () => {
  const endpoint = {
    id: "ep-1",
    adapterId: "conn-1",
    label: "List posts",
    method: "GET",
    path: "/posts",
    cache: null,
    createdAt: "2026-07-04T00:00:00.000Z",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: endpoint,
  }));
  const client = createConnectorsClient({ transport });

  const result = await client.addEndpoint("conn-1", {
    label: "List posts",
    method: "GET",
    path: "/posts",
  });

  assert.equal(calls[0]!.path, "/connectors/conn-1/endpoints");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, endpoint);
});

test("updateEndpoint() PATCHes /connectors/:id/endpoints/:epId with the input body", async () => {
  const endpoint = {
    id: "ep-1",
    adapterId: "conn-1",
    label: "renamed",
    method: "GET",
    path: "/posts",
    cache: null,
    createdAt: "2026-07-04T00:00:00.000Z",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: endpoint,
  }));
  const client = createConnectorsClient({ transport });

  await client.updateEndpoint("conn-1", "ep-1", { label: "renamed" });
  assert.equal(calls[0]!.path, "/connectors/conn-1/endpoints/ep-1");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { label: "renamed" });
});

test("removeEndpoint() DELETEs /connectors/:id/endpoints/:epId and resolves with no value", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createConnectorsClient({ transport });

  const result = await client.removeEndpoint("conn-1", "ep-1");
  assert.equal(calls[0]!.path, "/connectors/conn-1/endpoints/ep-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});
