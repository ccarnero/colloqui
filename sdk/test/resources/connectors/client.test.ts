import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import {
  ConflictError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "../../../src/domain/errors.js";
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

// --- T06 (manual-loops/connector-invoke-api.md): connectors.invoke() + connectors.invocations.get() ---

// Contract fixture from T02/T04: sync 200 body is `{ invocationId, ...IEndpointCallResult }`.
const sampleSyncInvokeResult = {
  invocationId: "inv-sync-1",
  status: 200,
  data: { ok: true },
  headers: { "content-type": "application/json" },
  cacheResult: "miss" as const,
};

test("invoke() defaults to mode: sync and POSTs the facade route with args + mode in the body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleSyncInvokeResult,
  }));
  const client = createConnectorsClient({ transport });

  const result = await client.invoke("conn-1", "ep-1", {
    method: "GET",
    params: { id: "1" },
  });

  assert.equal(calls[0]!.path, "/connectors/conn-1/endpoints/ep-1/invoke");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, {
    args: { method: "GET", params: { id: "1" } },
    mode: "sync",
  });
  assert.deepEqual(result, sampleSyncInvokeResult);
});

test("invoke() URL-encodes connectorId/endpointId in the path", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleSyncInvokeResult,
  }));
  const client = createConnectorsClient({ transport });

  await client.invoke("conn/1", "ep 1", { method: "GET" });
  assert.equal(calls[0]!.path, "/connectors/conn%2F1/endpoints/ep%201/invoke");
});

test("invoke() forwards idempotencyKey in the body (not the transport's Idempotency-Key header) — the facade contract reads it from the JSON body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleSyncInvokeResult,
  }));
  const client = createConnectorsClient({ transport });

  await client.invoke(
    "conn-1",
    "ep-1",
    { method: "POST", data: { a: 1 } },
    { idempotencyKey: "idem-1" }
  );
  assert.deepEqual(calls[0]!.body, {
    args: { method: "POST", data: { a: 1 } },
    mode: "sync",
    idempotencyKey: "idem-1",
  });
});

test("invoke({ mode: 'async' }) POSTs mode: async and returns the 202 accept body verbatim", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 202,
    body: { invocationId: "inv-async-1" },
  }));
  const client = createConnectorsClient({ transport });

  const result = await client.invoke(
    "conn-1",
    "ep-1",
    { method: "POST", data: { a: 1 } },
    { mode: "async", idempotencyKey: "idem-2" }
  );

  assert.deepEqual(calls[0]!.body, {
    args: { method: "POST", data: { a: 1 } },
    mode: "async",
    idempotencyKey: "idem-2",
  });
  assert.deepEqual(result, { invocationId: "inv-async-1" });
});

test("invoke({ mode: 'async', webhook }) forwards the webhook target verbatim in the body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 202,
    body: { invocationId: "inv-async-2" },
  }));
  const client = createConnectorsClient({ transport });

  await client.invoke(
    "conn-1",
    "ep-1",
    { method: "POST" },
    {
      mode: "async",
      webhook: { url: "https://example.com/hook", headers: { "x-a": "1" } },
    }
  );

  assert.deepEqual(calls[0]!.body, {
    args: { method: "POST" },
    mode: "async",
    webhook: { url: "https://example.com/hook", headers: { "x-a": "1" } },
  });
});

test("invoke({ webhook }) without mode: async rejects client-side with ValidationError before any request", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleSyncInvokeResult,
  }));
  const client = createConnectorsClient({ transport });

  await assert.rejects(
    () =>
      client.invoke(
        "conn-1",
        "ep-1",
        { method: "GET" },
        // @ts-expect-error — webhook without mode: "async" is a type error too; this exercises the runtime guard for untyped/JS callers.
        { webhook: { url: "https://example.com/hook" } }
      ),
    ValidationError
  );
  assert.equal(calls.length, 0);
});

test("invoke() propagates RateLimitError for a 429 (error-mapping passthrough)", async () => {
  const { transport } = fakeTransport(() => {
    throw new RateLimitError("request failed: rate limited");
  });
  const client = createConnectorsClient({ transport });

  await assert.rejects(
    () => client.invoke("conn-1", "ep-1", { method: "GET" }),
    RateLimitError
  );
});

test("invocations.get() GETs /connectors/invocations/:invocationId with the encoded id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { invocationId: "inv-1", status: "pending" },
  }));
  const client = createConnectorsClient({ transport });

  const result = await client.invocations.get("inv 1");
  assert.equal(calls[0]!.path, "/connectors/invocations/inv%201");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, { invocationId: "inv-1", status: "pending" });
});

test("invocations.get() returns the completed shape with outcome + result", async () => {
  const completed = {
    invocationId: "inv-1",
    status: "completed" as const,
    outcome: "ok" as const,
    result: sampleSyncInvokeResult,
  };
  const { transport } = fakeTransport(() => ({ status: 200, body: completed }));
  const client = createConnectorsClient({ transport });

  const result = await client.invocations.get("inv-1");
  assert.deepEqual(result, completed);
});

test("invocations.get() propagates NotFoundError for an unknown/expired invocationId (404)", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createConnectorsClient({ transport });

  await assert.rejects(() => client.invocations.get("gone"), NotFoundError);
});
