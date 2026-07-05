import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { NotFoundError } from "../../../src/domain/errors.js";
import { createWorkflowsClient } from "../../../src/resources/workflows/client.js";

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

test("create() POSTs /workflows with the input body and returns the created workflow", async () => {
  const workflow = {
    id: "wf-1",
    name: "e2e-http-log",
    application: "e2e",
    tenantId: "acme",
    actions: [{ name: "log", activity: "jsFunction", args: {} }],
    createdAt: "2026-07-04T00:00:00.000Z",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: workflow,
  }));
  const client = createWorkflowsClient({ transport });

  const result = await client.create({
    name: "e2e-http-log",
    application: "e2e",
    actions: [{ name: "log", activity: "jsFunction", args: {} }],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/workflows");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, {
    name: "e2e-http-log",
    application: "e2e",
    actions: [{ name: "log", activity: "jsFunction", args: {} }],
  });
  assert.deepEqual(result, workflow);
});

test("update() PUTs /workflows/:id with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { id: "wf-1" },
  }));
  const client = createWorkflowsClient({ transport });

  await client.update("wf-1", {
    name: "renamed",
    application: "e2e",
    actions: [],
  });

  assert.equal(calls[0]!.path, "/workflows/wf-1");
  assert.equal(calls[0]!.method, "PUT");
  assert.deepEqual(calls[0]!.body, {
    name: "renamed",
    application: "e2e",
    actions: [],
  });
});

test("update() URL-encodes the workflow id in the path", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: {},
  }));
  const client = createWorkflowsClient({ transport });
  await client.update("wf/needs encoding", {
    name: "x",
    application: "e2e",
    actions: [],
  });
  assert.equal(calls[0]!.path, "/workflows/wf%2Fneeds%20encoding");
});

test("list() GETs /workflows and degrades the bare array to a single page", async () => {
  const items = [{ id: "wf-1" }, { id: "wf-2" }];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: items,
  }));
  const client = createWorkflowsClient({ transport });

  const seen: unknown[] = [];
  for await (const wf of client.list()) {
    seen.push(wf);
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/workflows");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(seen, items);
});

test("list().page() returns the raw page without iterating", async () => {
  const items = [{ id: "wf-1" }];
  const { transport } = fakeTransport(() => ({ status: 200, body: items }));
  const client = createWorkflowsClient({ transport });

  const page = await client.list().page();
  assert.deepEqual(page.items, items);
  assert.equal(page.total, 1);
  assert.equal(page.hasMore, false);
});

test("get() GETs /workflows/:id", async () => {
  const workflow = { id: "wf-1", name: "x" };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: workflow,
  }));
  const client = createWorkflowsClient({ transport });

  const result = await client.get("wf-1");
  assert.equal(calls[0]!.path, "/workflows/wf-1");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, workflow);
});

test("get() propagates transport errors unchanged (error-mapping passthrough)", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createWorkflowsClient({ transport });

  await assert.rejects(() => client.get("missing"), NotFoundError);
});

test("remove() DELETEs /workflows/:id and resolves with no value", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createWorkflowsClient({ transport });

  const result = await client.remove("wf-1");
  assert.equal(calls[0]!.path, "/workflows/wf-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("execute() POSTs /workflows/:id/execute with { request, agentTimeoutSec }", async () => {
  const execResult = {
    executionId: "ex-1",
    definitionId: "wf-1",
    temporalWorkflowId: "acme:wf:ex-1",
    runId: "run-1",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 202,
    body: execResult,
  }));
  const client = createWorkflowsClient({ transport });

  const result = await client.execute("wf-1", {
    request: { foo: "bar" },
    agentTimeoutSec: 30,
  });

  assert.equal(calls[0]!.path, "/workflows/wf-1/execute");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, {
    request: { foo: "bar" },
    agentTimeoutSec: 30,
  });
  assert.deepEqual(result, execResult);
});

test("execute() forwards idempotencyKey to the transport", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 202,
    body: {
      executionId: "ex-1",
      definitionId: "wf-1",
      temporalWorkflowId: "x",
      runId: "y",
    },
  }));
  const client = createWorkflowsClient({ transport });

  await client.execute("wf-1", { request: {} }, { idempotencyKey: "idem-1" });

  assert.equal(calls[0]!.idempotencyKey, "idem-1");
});

test("listExecutions() converts limit/offset pagination into page/pageSize query params", async () => {
  const allItems = Array.from({ length: 5 }, (_, i) => ({
    id: `ex-${i}`,
    definitionId: "wf-1",
    tenantId: "acme",
    temporalWorkflowId: "x",
    temporalRunId: "y",
    request: {},
    status: "COMPLETED",
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
  }));
  const { transport, calls } = fakeTransport((call) => {
    const url = new URL(`http://x${call.path}`);
    const page = Number(url.searchParams.get("page"));
    const pageSize = Number(url.searchParams.get("pageSize"));
    const offset = (page - 1) * pageSize;
    const items = allItems.slice(offset, offset + pageSize);
    return {
      status: 200,
      body: { items, total: allItems.length, page, pageSize },
    };
  });
  const client = createWorkflowsClient({ transport });

  const seen: unknown[] = [];
  for await (const ex of client.listExecutions("wf-1", { pageSize: 2 })) {
    seen.push(ex);
  }

  assert.deepEqual(seen, allItems);
  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.path, "/workflows/wf-1/executions?page=1&pageSize=2");
  assert.equal(calls[1]!.path, "/workflows/wf-1/executions?page=2&pageSize=2");
  assert.equal(calls[2]!.path, "/workflows/wf-1/executions?page=3&pageSize=2");
});

test("listExecutions() forwards an explicit sort param", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { items: [], total: 0, page: 1, pageSize: 20 },
  }));
  const client = createWorkflowsClient({ transport });

  await client.listExecutions("wf-1", { sort: "asc" }).page();
  assert.ok(calls[0]!.path.includes("sort=asc"));
});

test("getExecution() GETs /workflows/:id/executions/:executionId", async () => {
  const status = {
    executionId: "ex-1",
    definitionId: "wf-1",
    temporalWorkflowId: "x",
    status: "COMPLETED",
    createdAt: "2026-07-04T00:00:00.000Z",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: status,
  }));
  const client = createWorkflowsClient({ transport });

  const result = await client.getExecution("wf-1", "ex-1");
  assert.equal(calls[0]!.path, "/workflows/wf-1/executions/ex-1");
  assert.deepEqual(result, status);
});

test("executionCounts() GETs /workflows/executions/counts", async () => {
  const counts = { "wf-1": 3, "wf-2": 1 };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: counts,
  }));
  const client = createWorkflowsClient({ transport });

  const result = await client.executionCounts();
  assert.equal(calls[0]!.path, "/workflows/executions/counts");
  assert.deepEqual(result, counts);
});

test("executionsByCorrelation() GETs /workflows/executions?correlation_id=... and degrades to a single page", async () => {
  const items = [{ id: "ex-1" }];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: items,
  }));
  const client = createWorkflowsClient({ transport });

  const seen: unknown[] = [];
  for await (const ex of client.executionsByCorrelation("corr-1")) {
    seen.push(ex);
  }

  assert.equal(calls[0]!.path, "/workflows/executions?correlation_id=corr-1");
  assert.deepEqual(seen, items);
});

test("summary() GETs /workflows/summary and returns the aggregate stats", async () => {
  const summary = {
    activeDefinitions: 8,
    definitionsFailingNow: 0,
    definitionsWithFailuresLast7d: 0,
    executionsCompletedLast7d: 125,
    executionsFailedLast7d: 0,
    executionsRunningLast7d: 0,
    executionsCompletedLast24h: 87,
    topByExecutionCountLast7d: [
      { definition_id: "wf-1", name: "e2e-http-log", application: "e2e", count: 54 },
    ],
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: summary,
  }));
  const client = createWorkflowsClient({ transport });

  const result = await client.summary();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/workflows/summary");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, summary);
});
