import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { NotFoundError } from "../../../src/domain/errors.js";
import { createSystemVariablesClient } from "../../../src/resources/system-variables/client.js";

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

const sampleVariable = {
  id: "var-1",
  name: "SDK_TEST_VAR",
  type: "string" as const,
  value: "hello",
  label: null,
  description: null,
  created_at: "2026-07-04T00:00:00.000Z",
  updated_at: "2026-07-04T00:00:00.000Z",
};

test("create() POSTs /admin/system-variables with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleVariable,
  }));
  const client = createSystemVariablesClient({ transport });

  const result = await client.create({
    name: "SDK_TEST_VAR",
    type: "string",
    value: "hello",
  });

  assert.equal(calls[0]!.path, "/admin/system-variables");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, sampleVariable);
});

test("list() GETs /admin/system-variables with limit/offset and adapts { variables, total } via toOffsetPage", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { variables: [sampleVariable], total: 1 },
  }));
  const client = createSystemVariablesClient({ transport });

  const seen: unknown[] = [];
  for await (const v of client.list()) {
    seen.push(v);
  }

  assert.equal(calls[0]!.path, "/admin/system-variables?limit=50&offset=0");
  assert.deepEqual(seen, [sampleVariable]);
});

test("get() GETs /admin/system-variables/:id and returns null when the downstream returns null", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: null,
  }));
  const client = createSystemVariablesClient({ transport });

  const result = await client.get("missing");
  assert.equal(calls[0]!.path, "/admin/system-variables/missing");
  assert.equal(calls[0]!.method, "GET");
  assert.equal(result, null);
});

test("get() propagates transport errors unchanged (error-mapping passthrough)", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createSystemVariablesClient({ transport });

  await assert.rejects(() => client.get("var-1"), NotFoundError);
});

test("update() PATCHes /admin/system-variables/:id with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleVariable, value: "updated" },
  }));
  const client = createSystemVariablesClient({ transport });

  const result = await client.update("var-1", { value: "updated" });
  assert.equal(calls[0]!.path, "/admin/system-variables/var-1");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { value: "updated" });
  assert.equal(result!.value, "updated");
});

test("remove() DELETEs /admin/system-variables/:id and returns the bare boolean body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: true,
  }));
  const client = createSystemVariablesClient({ transport });

  const result = await client.remove("var-1");
  assert.equal(calls[0]!.path, "/admin/system-variables/var-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, true);
});
