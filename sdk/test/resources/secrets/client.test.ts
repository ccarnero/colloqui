import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { PermissionError } from "../../../src/domain/errors.js";
import { createSecretsClient } from "../../../src/resources/secrets/client.js";

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
    async requestStream() {
      throw new Error("not used in this test");
    },
  };
  return { transport, calls };
}

test("set() PUTs /provisioning/secrets/:name with { value, scope } and echoes only { name, scope }", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: {
      name: "telegram-token",
      scope: { kind: "channel", owner: "telegram-in" },
    },
  }));
  const client = createSecretsClient({ transport });

  const result = await client.set("telegram-token", "super-secret-value", {
    kind: "channel",
    owner: "telegram-in",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/provisioning/secrets/telegram-token");
  assert.equal(calls[0]!.method, "PUT");
  assert.deepEqual(calls[0]!.body, {
    value: "super-secret-value",
    scope: { kind: "channel", owner: "telegram-in" },
  });
  // Write-only guarantee: the response never carries a value field.
  assert.deepEqual(result, {
    name: "telegram-token",
    scope: { kind: "channel", owner: "telegram-in" },
  });
  assert.equal((result as { value?: unknown }).value, undefined);
});

test("set() URL-encodes the secret name in the path", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { name: "needs encoding/x", scope: { kind: "agent", owner: "bot" } },
  }));
  const client = createSecretsClient({ transport });

  await client.set("needs encoding/x", "v", { kind: "agent", owner: "bot" });
  assert.equal(calls[0]!.path, "/provisioning/secrets/needs%20encoding%2Fx");
});

test("set() sends the value in the request body but never returns or duplicates it anywhere else", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { name: "sec-1", scope: { kind: "connector", owner: "c1" } },
  }));
  const client = createSecretsClient({ transport });

  const secretValue = "correct-horse-battery-staple";
  const result = await client.set("sec-1", secretValue, {
    kind: "connector",
    owner: "c1",
  });

  // Body carries it once (the only place it may appear).
  assert.equal((calls[0]!.body as { value: string }).value, secretValue);
  // Nowhere in the returned result.
  assert.ok(!JSON.stringify(result).includes(secretValue));
});

test("set() propagates PermissionError when the caller lacks the tenant admin scope (403)", async () => {
  const { transport } = fakeTransport(() => {
    throw new PermissionError("request failed: forbidden");
  });
  const client = createSecretsClient({ transport });

  await assert.rejects(
    () => client.set("sec-1", "v", { kind: "connector", owner: "c1" }),
    PermissionError
  );
});

test("set() accepts a per-call retry override", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { name: "sec-1", scope: { kind: "connector", owner: "c1" } },
  }));
  const client = createSecretsClient({ transport });

  await client.set(
    "sec-1",
    "v",
    { kind: "connector", owner: "c1" },
    { retry: false }
  );
  assert.equal(calls[0]!.retry, false);
});

test("list() GETs /provisioning/secrets and unwraps the {secrets} envelope to names + bindings only", async () => {
  const bindings = [
    {
      name: "telegram-token",
      scope: { kind: "channel", owner: "telegram-in" },
    },
    { name: "openai-key", scope: { kind: "agent", owner: "support-bot" } },
  ];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { secrets: bindings },
  }));
  const client = createSecretsClient({ transport });

  const result = await client.list();
  assert.equal(calls[0]!.path, "/provisioning/secrets");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, bindings);
  // Never a value field anywhere in the list response.
  for (const entry of result) {
    assert.equal((entry as { value?: unknown }).value, undefined);
  }
});

test("list() accepts a per-call retry override", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { secrets: [] },
  }));
  const client = createSecretsClient({ transport });

  await client.list({ retry: false });
  assert.equal(calls[0]!.retry, false);
});
