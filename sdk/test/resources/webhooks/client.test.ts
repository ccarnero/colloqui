import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { RateLimitError } from "../../../src/domain/errors.js";
import { createWebhooksClient } from "../../../src/resources/webhooks/client.js";

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

test("ingest() POSTs /webhooks/:channel/:tenantId for the legacy per-tenant path", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { status: "accepted" },
  }));
  const client = createWebhooksClient({ transport });

  const result = await client.ingest({
    tenant: "acme",
    channel: "http",
    body: { from: "user-1", text: "hi" },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/webhooks/http/acme");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, { from: "user-1", text: "hi" });
  assert.equal(calls[0]!.auth, false);
  assert.equal(calls[0]!.tenant, "acme");
  assert.deepEqual(result, { status: "accepted" });
});

test("ingest() POSTs the instance-addressed path when instance is provided", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { status: "accepted" },
  }));
  const client = createWebhooksClient({ transport });

  await client.ingest({
    tenant: "acme",
    channel: "whatsapp",
    instance: "ext-123",
    body: { entry: [] },
  });

  assert.equal(calls[0]!.path, "/webhooks/whatsapp/acme/ext-123");
});

test("ingest() URL-encodes channel, tenant, and instance segments", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { status: "accepted" },
  }));
  const client = createWebhooksClient({ transport });

  await client.ingest({
    tenant: "acme/tenant",
    channel: "ht tp",
    instance: "ext/1",
    body: {},
  });

  assert.equal(calls[0]!.path, "/webhooks/ht%20tp/acme%2Ftenant/ext%2F1");
});

test("ingest() forwards caller headers (e.g. x-http-channel-token) to the transport", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { status: "accepted" },
  }));
  const client = createWebhooksClient({ transport });

  await client.ingest({
    tenant: "acme",
    channel: "http",
    body: {},
    headers: { "x-http-channel-token": "secret" },
  });

  assert.deepEqual(calls[0]!.headers, { "x-http-channel-token": "secret" });
});

test("ingest() propagates transport errors unchanged (error-mapping passthrough)", async () => {
  const { transport } = fakeTransport(() => {
    throw new RateLimitError("request failed: rate limited");
  });
  const client = createWebhooksClient({ transport });

  await assert.rejects(
    () => client.ingest({ tenant: "acme", channel: "http", body: {} }),
    RateLimitError
  );
});
