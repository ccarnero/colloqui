import assert from "node:assert/strict";
import { test } from "node:test";
import { SdkError } from "../../src/domain/errors.js";
import { httpJson } from "../../src/infrastructure/http.js";

function fakeResponse({ status = 200, body = "" as unknown } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

test("encodes a JSON body and sets Content-Type", async () => {
  let captured: any;
  const fetchImpl = async (url: string, opts: any) => {
    captured = { url, opts };
    return fakeResponse({ body: { ok: true } });
  };
  const res = await httpJson(fetchImpl, {
    url: "http://x",
    method: "POST",
    body: { a: 1 },
    timeoutMs: 50,
  });
  assert.equal(captured.opts.headers["Content-Type"], "application/json");
  assert.equal(captured.opts.body, JSON.stringify({ a: 1 }));
  assert.deepEqual(res.body, { ok: true });
  assert.equal(res.ok, true);
});

test("returns a non-ok status without throwing", async () => {
  const fetchImpl = async () =>
    fakeResponse({ status: 401, body: { error: "nope" } });
  const res = await httpJson(fetchImpl, { url: "http://x", timeoutMs: 50 });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: "nope" });
});

test("wraps network errors in SdkError", async () => {
  const fetchImpl = async () => {
    throw new Error("boom");
  };
  await assert.rejects(
    () => httpJson(fetchImpl, { url: "http://x", timeoutMs: 50 }),
    (err: unknown) => err instanceof SdkError && err.code === "NETWORK"
  );
});
