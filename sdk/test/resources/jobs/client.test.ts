import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { createJobsClient } from "../../../src/resources/jobs/client.js";

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

const sampleJob = {
  id: "job-1",
  name: "sdk-e2e-fin-job",
  agent_id: "agent-1",
  schedule: "0 * * * *",
  payload: {},
  is_active: false,
  last_run: null,
  next_run: null,
  created_at: "2026-07-04T00:00:00.000Z",
  updated_at: "2026-07-04T00:00:00.000Z",
};

const sampleExecution = {
  id: "exec-1",
  job_id: "job-1",
  status: "pending" as const,
  event_payload: {},
  result: null,
  logs: [],
  error_message: null,
  retry_count: 0,
  triggered_by: null,
  started_at: null,
  finished_at: null,
  created_at: "2026-07-04T00:00:00.000Z",
};

test("create() POSTs /admin/jobs with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleJob,
  }));
  const client = createJobsClient({ transport });

  const result = await client.create({
    name: "sdk-e2e-fin-job",
    agent_id: "agent-1",
    schedule: "0 * * * *",
    is_active: false,
  });
  assert.equal(calls[0]!.path, "/admin/jobs");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, sampleJob);
});

test("list() GETs /admin/jobs with real limit/offset pagination ({jobs,total})", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { jobs: [sampleJob], total: 1 },
  }));
  const client = createJobsClient({ transport });

  const seen: unknown[] = [];
  for await (const job of client.list()) {
    seen.push(job);
  }
  assert.equal(calls[0]!.path, "/admin/jobs?limit=50&offset=0");
  assert.deepEqual(seen, [sampleJob]);
});

test("list() forwards agent_id/is_active filters", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { jobs: [], total: 0 },
  }));
  const client = createJobsClient({ transport });

  await client.list({ agent_id: "agent-1", is_active: true }).page();
  assert.equal(
    calls[0]!.path,
    "/admin/jobs?agent_id=agent-1&is_active=true&limit=50&offset=0"
  );
});

test("get() GETs /admin/jobs/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleJob,
  }));
  const client = createJobsClient({ transport });

  const result = await client.get("job-1");
  assert.equal(calls[0]!.path, "/admin/jobs/job-1");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleJob);
});

test("update() PUTs /admin/jobs/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleJob, name: "renamed" },
  }));
  const client = createJobsClient({ transport });

  await client.update("job-1", { name: "renamed" });
  assert.equal(calls[0]!.path, "/admin/jobs/job-1");
  assert.equal(calls[0]!.method, "PUT");
  assert.deepEqual(calls[0]!.body, { name: "renamed" });
});

test("remove() DELETEs /admin/jobs/:id and resolves with no value", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createJobsClient({ transport });

  const result = await client.remove("job-1");
  assert.equal(calls[0]!.path, "/admin/jobs/job-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("enable() POSTs /admin/jobs/:id/enable", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleJob, is_active: true },
  }));
  const client = createJobsClient({ transport });

  const result = await client.enable("job-1");
  assert.equal(calls[0]!.path, "/admin/jobs/job-1/enable");
  assert.equal(calls[0]!.method, "POST");
  assert.equal(result.is_active, true);
});

test("disable() POSTs /admin/jobs/:id/disable", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleJob, is_active: false },
  }));
  const client = createJobsClient({ transport });

  const result = await client.disable("job-1");
  assert.equal(calls[0]!.path, "/admin/jobs/job-1/disable");
  assert.equal(calls[0]!.method, "POST");
  assert.equal(result.is_active, false);
});

test("run() POSTs /admin/jobs/:id/run with no body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleExecution,
  }));
  const client = createJobsClient({ transport });

  const result = await client.run("job-1");
  assert.equal(calls[0]!.path, "/admin/jobs/job-1/run");
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.body, undefined);
  assert.deepEqual(result, sampleExecution);
});

test("trigger() POSTs /admin/jobs/:id/trigger with a `payload` field (gateway DTO shape)", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleExecution,
  }));
  const client = createJobsClient({ transport });

  await client.trigger("job-1", { payload: { foo: "bar" } });
  assert.equal(calls[0]!.path, "/admin/jobs/job-1/trigger");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, { payload: { foo: "bar" } });
});

test("executions.list() GETs /admin/jobs/executions with real limit/offset pagination ({executions,total})", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { executions: [sampleExecution], total: 1 },
  }));
  const client = createJobsClient({ transport });

  const seen: unknown[] = [];
  for await (const exec of client.executions.list()) {
    seen.push(exec);
  }
  assert.equal(calls[0]!.path, "/admin/jobs/executions?limit=50&offset=0");
  assert.deepEqual(seen, [sampleExecution]);
});
