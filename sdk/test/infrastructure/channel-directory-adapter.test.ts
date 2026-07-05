import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../src/core/transport.js";
import { ChannelResolutionError } from "../../src/domain/errors.js";
import { createChannelDirectoryAdapter } from "../../src/infrastructure/channel-directory-adapter.js";

/**
 * `channel-directory-adapter` now delegates all HTTP concerns to the shared
 * `Transport` (P1.2). Tests exercise it against a fake `Transport` instead
 * of a fake `fetch`, preserving the same scenarios (selection rules, error
 * mapping) via the request/response shape the adapter actually consumes.
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

test("requests channel=http with the explicit token + tenant and returns the secret", async () => {
  const accounts = [
    { id: "x", channel: "telegram", isActive: true, appSecret: "no" },
    {
      id: "acc1",
      channel: "http",
      isActive: true,
      appSecret: "sec",
      name: "main",
    },
  ];
  const { transport, calls } = fakeTransport(async () => ({
    status: 200,
    body: accounts,
  }));
  const dir = createChannelDirectoryAdapter({ transport });
  const out = await dir.resolveHttpSecret({ token: "tok", tenant: "acme" });

  assert.equal(calls[0].path, "/channels/accounts?channel=http");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].token, "tok");
  assert.equal(calls[0].tenant, "acme");
  assert.deepEqual(out, { appSecret: "sec", accountId: "acc1" });
});

test("ignores inactive accounts", async () => {
  const { transport } = fakeTransport(async () => ({
    status: 200,
    body: [{ id: "a", channel: "http", isActive: false, appSecret: "s" }],
  }));
  const dir = createChannelDirectoryAdapter({ transport });
  await assert.rejects(
    () => dir.resolveHttpSecret({ token: "t", tenant: "acme" }),
    ChannelResolutionError
  );
});

test("selects by externalId when a selector is given", async () => {
  const accounts = [
    {
      id: "a1",
      channel: "http",
      isActive: true,
      appSecret: "s1",
      externalId: "src1",
    },
    {
      id: "a2",
      channel: "http",
      isActive: true,
      appSecret: "s2",
      externalId: "src2",
    },
  ];
  const { transport } = fakeTransport(async () => ({
    status: 200,
    body: accounts,
  }));
  const dir = createChannelDirectoryAdapter({ transport });
  const out = await dir.resolveHttpSecret({
    token: "t",
    tenant: "acme",
    selector: { externalId: "src2" },
  });
  assert.equal(out.accountId, "a2");
});

test("throws ChannelResolutionError when the transport rejects (e.g. 403)", async () => {
  const { transport } = fakeTransport(async () => {
    throw new PermissionError("request failed: forbidden", {
      details: { httpStatus: 403, body: { error: "forbidden" } },
    });
  });
  const dir = createChannelDirectoryAdapter({ transport });
  await assert.rejects(
    () => dir.resolveHttpSecret({ token: "t", tenant: "acme" }),
    ChannelResolutionError
  );
});

test("throws when the chosen account has no appSecret", async () => {
  const { transport } = fakeTransport(async () => ({
    status: 200,
    body: [{ id: "a", channel: "http", isActive: true }],
  }));
  const dir = createChannelDirectoryAdapter({ transport });
  await assert.rejects(
    () => dir.resolveHttpSecret({ token: "t", tenant: "acme" }),
    ChannelResolutionError
  );
});
