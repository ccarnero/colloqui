import { test } from "node:test";
import assert from "node:assert/strict";
import { createIngestAdapter } from "../../src/infrastructure/ingest-adapter.js";
import { IngestError } from "../../src/domain/errors.js";

function res({ status = 200, body }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("posts to the webhook path with the channel token and accepts", async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return res({ body: { status: "accepted" } });
  };
  const adapter = createIngestAdapter({ fetchImpl, baseUrl: "http://x", timeoutMs: 50 });
  const out = await adapter.ingest({
    tenant: "acme",
    appSecret: "sec",
    body: { from: "u", text: "hi" },
  });

  assert.equal(captured.url, "http://x/api/webhooks/http/acme");
  assert.equal(captured.opts.headers["x-http-channel-token"], "sec");
  assert.equal(captured.opts.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(captured.opts.body), { from: "u", text: "hi" });
  assert.equal(out.status, "accepted");
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
    const fetchImpl = async () => res({ body: { status } });
    const adapter = createIngestAdapter({ fetchImpl, baseUrl: "http://x", timeoutMs: 50 });
    await assert.rejects(
      () => adapter.ingest({ tenant: "t", appSecret: "s", body: { from: "u" } }),
      (err) => err instanceof IngestError && err.ingestStatus === status,
    );
  }
});

test("throws IngestError on a non-2xx http response", async () => {
  const fetchImpl = async () => res({ status: 500, body: { error: "boom" } });
  const adapter = createIngestAdapter({ fetchImpl, baseUrl: "http://x", timeoutMs: 50 });
  await assert.rejects(
    () => adapter.ingest({ tenant: "t", appSecret: "s", body: {} }),
    IngestError,
  );
});
