import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { NotFoundError } from "../../../src/domain/errors.js";
import { createRuntimeClient } from "../../../src/resources/runtime/client.js";

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

test("createExecution() POSTs /runtime/executions with the input body", async () => {
  const result = { executionId: "ex-1", status: "accepted" as const };
  const { transport, calls } = fakeTransport(() => ({
    status: 202,
    body: result,
  }));
  const client = createRuntimeClient({ transport });

  const created = await client.createExecution({
    agentId: "agent-1",
    message: "hello",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/runtime/executions");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, { agentId: "agent-1", message: "hello" });
  assert.deepEqual(created, result);
});

test("createExecution() forwards optional fields (conversationId, context, ...)", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 202,
    body: { executionId: "ex-1", status: "accepted" as const },
  }));
  const client = createRuntimeClient({ transport });

  await client.createExecution({
    agentId: "agent-1",
    message: "hello",
    conversationId: "conv-1",
    customerName: "Ada",
    userId: "user-1",
    channel: "http",
    context: [{ sender: "customer", content: "hi" }],
  });

  assert.deepEqual(calls[0]!.body, {
    agentId: "agent-1",
    message: "hello",
    conversationId: "conv-1",
    customerName: "Ada",
    userId: "user-1",
    channel: "http",
    context: [{ sender: "customer", content: "hi" }],
  });
});

test("getExecution() GETs /runtime/executions/:id", async () => {
  const status = {
    executionId: "ex-1",
    tenantId: "acme",
    type: "chat",
    state: "completed",
    requestedAt: "2026-07-04T00:00:00.000Z",
    agentId: "agent-1",
    result: { reply: "hi there" },
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: status,
  }));
  const client = createRuntimeClient({ transport });

  const result = await client.getExecution("ex-1");
  assert.equal(calls[0]!.path, "/runtime/executions/ex-1");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, status);
});

test("getExecution() URL-encodes the execution id in the path", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: {},
  }));
  const client = createRuntimeClient({ transport });
  await client.getExecution("ex/needs encoding");
  assert.equal(calls[0]!.path, "/runtime/executions/ex%2Fneeds%20encoding");
});

test("getExecution() propagates transport errors unchanged (error-mapping passthrough)", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createRuntimeClient({ transport });

  await assert.rejects(() => client.getExecution("missing"), NotFoundError);
});

test("health() GETs /runtime/health unauthenticated", async () => {
  const health = { status: "ok" };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: health,
  }));
  const client = createRuntimeClient({ transport });

  const result = await client.health();
  assert.equal(calls[0]!.path, "/runtime/health");
  assert.equal(calls[0]!.method, "GET");
  assert.equal(calls[0]!.auth, false);
  assert.deepEqual(result, health);
});
