import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../src/core/transport.js";
import { IngestError, SdkError } from "../../src/domain/errors.js";
import { createIngestAdapter } from "../../src/infrastructure/ingest-adapter.js";

/**
 * `ingest-adapter` now delegates all HTTP concerns to the shared `Transport`
 * (P1.2), always calling it unauthenticated (`auth: false`) since the http
 * channel authenticates via the per-account `x-http-channel-token` header,
 * not a session bearer token. Tests exercise it against a fake `Transport`.
 */
function fakeTransport(
  handler: (
    opts: TransportRequestOptions
  ) => Promise<TransportResponse<unknown>>
): { transport: Transport; calls: TransportRequestOptions[] } {
  const calls: TransportRequestOptions[] = [];
  return {
    transport: {
      request: async (opts) => {
        calls.push(opts);
        return handler(opts) as Promise<TransportResponse<never>>;
      },
    },
    calls,
  };
}

test("posts to the webhook path with the channel token, unauthenticated, and accepts", async () => {
  const { transport, calls } = fakeTransport(async () => ({
    status: 200,
    body: { status: "accepted" },
  }));
  const adapter = createIngestAdapter({ transport });
  const out = await adapter.ingest({
    tenant: "acme",
    appSecret: "sec",
    body: { from: "u", text: "hi" },
  });

  assert.equal(calls[0].path, "/webhooks/http/acme");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers?.["x-http-channel-token"], "sec");
  assert.equal(calls[0].auth, false);
  assert.deepEqual(calls[0].body, { from: "u", text: "hi" });
  assert.equal(out.status, "accepted");
});

test("addresses the per-instance path when instance is given", async () => {
  const { transport, calls } = fakeTransport(async () => ({
    status: 200,
    body: { status: "accepted" },
  }));
  const adapter = createIngestAdapter({ transport });
  await adapter.ingest({
    tenant: "acme",
    appSecret: "sec",
    body: {},
    instance: "src1",
  });
  assert.equal(calls[0].path, "/webhooks/http/acme/src1");
});

test("maps every non-accepted status to an IngestError", async () => {
  const statuses = [
    "signature_mismatch",
    "unsupported_channel",
    "no_active_accounts",
    "invalid_payload",
    "no_messages",
  ];
  for (const status of statuses) {
    const { transport } = fakeTransport(async () => ({
      status: 200,
      body: { status },
    }));
    const adapter = createIngestAdapter({ transport });
    await assert.rejects(
      () =>
        adapter.ingest({ tenant: "t", appSecret: "s", body: { from: "u" } }),
      (err: unknown) =>
        err instanceof IngestError && err.ingestStatus === status
    );
  }
});

test("throws IngestError when the transport rejects (non-2xx http response)", async () => {
  const { transport } = fakeTransport(async () => {
    throw new SdkError("request failed with status 500", {
      code: "HTTP",
      details: { httpStatus: 500, body: { error: "boom" } },
    });
  });
  const adapter = createIngestAdapter({ transport });
  await assert.rejects(
    () => adapter.ingest({ tenant: "t", appSecret: "s", body: {} }),
    IngestError
  );
});
