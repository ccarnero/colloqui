import { test } from "node:test";
import assert from "node:assert/strict";
import { createChannelDirectoryAdapter } from "../../src/infrastructure/channel-directory-adapter.js";
import { ChannelResolutionError } from "../../src/domain/errors.js";

function res({ status = 200, body }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("requests channel=http with auth + tenant headers and returns the secret", async () => {
  let captured;
  const accounts = [
    { id: "x", channel: "telegram", isActive: true, appSecret: "no" },
    { id: "acc1", channel: "http", isActive: true, appSecret: "sec", name: "main" },
  ];
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return res({ body: accounts });
  };
  const dir = createChannelDirectoryAdapter({
    fetchImpl,
    baseUrl: "http://x",
    timeoutMs: 50,
  });
  const out = await dir.resolveHttpSecret({ token: "tok", tenant: "acme" });

  assert.equal(captured.url, "http://x/api/channels/accounts?channel=http");
  assert.equal(captured.opts.headers.Authorization, "Bearer tok");
  assert.equal(captured.opts.headers["x-yoizen-tenant"], "acme");
  assert.deepEqual(out, { appSecret: "sec", accountId: "acc1" });
});

test("ignores inactive accounts", async () => {
  const fetchImpl = async () =>
    res({ body: [{ id: "a", channel: "http", isActive: false, appSecret: "s" }] });
  const dir = createChannelDirectoryAdapter({ fetchImpl, baseUrl: "http://x", timeoutMs: 50 });
  await assert.rejects(
    () => dir.resolveHttpSecret({ token: "t", tenant: "acme" }),
    ChannelResolutionError,
  );
});

test("selects by externalId when a selector is given", async () => {
  const accounts = [
    { id: "a1", channel: "http", isActive: true, appSecret: "s1", externalId: "src1" },
    { id: "a2", channel: "http", isActive: true, appSecret: "s2", externalId: "src2" },
  ];
  const fetchImpl = async () => res({ body: accounts });
  const dir = createChannelDirectoryAdapter({ fetchImpl, baseUrl: "http://x", timeoutMs: 50 });
  const out = await dir.resolveHttpSecret({
    token: "t",
    tenant: "acme",
    selector: { externalId: "src2" },
  });
  assert.equal(out.accountId, "a2");
});

test("throws on a non-ok response", async () => {
  const fetchImpl = async () => res({ status: 403, body: { error: "forbidden" } });
  const dir = createChannelDirectoryAdapter({ fetchImpl, baseUrl: "http://x", timeoutMs: 50 });
  await assert.rejects(
    () => dir.resolveHttpSecret({ token: "t", tenant: "acme" }),
    ChannelResolutionError,
  );
});

test("throws when the chosen account has no appSecret", async () => {
  const fetchImpl = async () =>
    res({ body: [{ id: "a", channel: "http", isActive: true }] });
  const dir = createChannelDirectoryAdapter({ fetchImpl, baseUrl: "http://x", timeoutMs: 50 });
  await assert.rejects(
    () => dir.resolveHttpSecret({ token: "t", tenant: "acme" }),
    ChannelResolutionError,
  );
});
