import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { NotFoundError } from "../../../src/domain/errors.js";
import { createChannelsClient } from "../../../src/resources/channels/client.js";

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

const sampleAccount = {
  id: "acc-1",
  tenantId: "acme",
  channel: "http" as const,
  provider: "http" as const,
  name: "SDK test account",
  externalId: "ext-1",
  accessToken: "token",
  isActive: true,
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z",
};

test("createAccount() POSTs /channels/accounts with the input body and returns the created account", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleAccount,
  }));
  const client = createChannelsClient({ transport });

  const result = await client.createAccount({
    channel: "http",
    name: "SDK test account",
    externalId: "ext-1",
    accessToken: "token",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/channels/accounts");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, sampleAccount);
});

test("listAccounts() GETs /channels/accounts and degrades the bare array to a single page", async () => {
  const items = [sampleAccount];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: items,
  }));
  const client = createChannelsClient({ transport });

  const seen: unknown[] = [];
  for await (const acc of client.listAccounts()) {
    seen.push(acc);
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/channels/accounts");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(seen, items);
});

test("listAccounts() forwards the channel filter as a query param", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: [],
  }));
  const client = createChannelsClient({ transport });

  await client.listAccounts({ channel: "whatsapp" }).page();
  assert.equal(calls[0]!.path, "/channels/accounts?channel=whatsapp");
});

test("getAccount() GETs /channels/accounts/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleAccount,
  }));
  const client = createChannelsClient({ transport });

  const result = await client.getAccount("acc-1");
  assert.equal(calls[0]!.path, "/channels/accounts/acc-1");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleAccount);
});

test("getAccount() propagates transport errors unchanged (error-mapping passthrough)", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createChannelsClient({ transport });

  await assert.rejects(() => client.getAccount("missing"), NotFoundError);
});

test("updateAccount() PATCHes /channels/accounts/:id with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleAccount, name: "renamed" },
  }));
  const client = createChannelsClient({ transport });

  await client.updateAccount("acc-1", { name: "renamed" });
  assert.equal(calls[0]!.path, "/channels/accounts/acc-1");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { name: "renamed" });
});

test("updateAccount() URL-encodes the account id in the path", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleAccount,
  }));
  const client = createChannelsClient({ transport });
  await client.updateAccount("acc/needs encoding", { name: "x" });
  assert.equal(calls[0]!.path, "/channels/accounts/acc%2Fneeds%20encoding");
});

test("removeAccount() DELETEs /channels/accounts/:id and resolves with no value", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createChannelsClient({ transport });

  const result = await client.removeAccount("acc-1");
  assert.equal(calls[0]!.path, "/channels/accounts/acc-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("refreshAccountToken() POSTs /channels/accounts/:id/refresh-token", async () => {
  const refreshed = {
    accessToken: "abc123..z9y8",
    tokenType: "bearer",
    expiresIn: 5184000,
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: refreshed,
  }));
  const client = createChannelsClient({ transport });

  const result = await client.refreshAccountToken("acc-1");
  assert.equal(calls[0]!.path, "/channels/accounts/acc-1/refresh-token");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, refreshed);
});

test("sendMessage() POSTs /channels/:accountId/messages with the input body", async () => {
  const sendResult = {
    success: true,
    providerMessageId: "wamid.abc",
    timestamp: "2026-07-04T00:00:00.000Z",
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sendResult,
  }));
  const client = createChannelsClient({ transport });

  const result = await client.sendMessage("acc-1", {
    to: "+5491100000000",
    type: "text",
    text: "hello",
  });

  assert.equal(calls[0]!.path, "/channels/acc-1/messages");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, {
    to: "+5491100000000",
    type: "text",
    text: "hello",
  });
  assert.deepEqual(result, sendResult);
});

test("createAutoReplyRule() POSTs /channels/auto-reply with the input body", async () => {
  const rule = {
    id: "rule-1",
    tenantId: "acme",
    accountId: "acc-1",
    channel: "whatsapp" as const,
    triggerPattern: "hello",
    replyText: "hi there",
    isActive: true,
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: rule,
  }));
  const client = createChannelsClient({ transport });

  const result = await client.createAutoReplyRule({
    accountId: "acc-1",
    channel: "whatsapp",
    triggerPattern: "hello",
    replyText: "hi there",
  });

  assert.equal(calls[0]!.path, "/channels/auto-reply");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, rule);
});

test("listAutoReplyRules() GETs /channels/auto-reply and degrades to a single page", async () => {
  const items = [
    {
      id: "rule-1",
      tenantId: "acme",
      accountId: "acc-1",
      channel: "whatsapp" as const,
      triggerPattern: "hello",
      replyText: "hi there",
      isActive: true,
    },
  ];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: items,
  }));
  const client = createChannelsClient({ transport });

  const seen: unknown[] = [];
  for await (const rule of client.listAutoReplyRules({ accountId: "acc-1" })) {
    seen.push(rule);
  }

  assert.equal(calls[0]!.path, "/channels/auto-reply?accountId=acc-1");
  assert.deepEqual(seen, items);
});

test("removeAutoReplyRule() DELETEs /channels/auto-reply/:id and resolves with no value", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createChannelsClient({ transport });

  const result = await client.removeAutoReplyRule("rule-1");
  assert.equal(calls[0]!.path, "/channels/auto-reply/rule-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("listStreams() GETs /channels/streams and unwraps the { items } envelope into a single page", async () => {
  const items = [
    {
      name: "INGRESS-acme",
      kind: "ingress" as const,
      subjects: ["evt.acme.>"],
      messages: 10,
      bytes: 1024,
      firstSeq: 1,
      lastSeq: 10,
      firstTs: "2026-07-04T00:00:00.000Z",
      lastTs: "2026-07-04T00:01:00.000Z",
      maxAgeNs: 0,
      maxBytes: 0,
      consumerCount: 1,
    },
  ];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { items },
  }));
  const client = createChannelsClient({ transport });

  const seen: unknown[] = [];
  for await (const stream of client.listStreams()) {
    seen.push(stream);
  }

  assert.equal(calls[0]!.path, "/channels/streams");
  assert.deepEqual(seen, items);
});

test("streamMessages() GETs /channels/streams/:key/messages with query params and unwraps { items }", async () => {
  const items = [
    {
      seq: 1,
      subject: "evt.acme.channel-service.messaging.http.received.v1",
      ts: "2026-07-04T00:00:00.000Z",
      headers: {},
      data: { hello: "world" },
      size: 42,
    },
  ];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { items },
  }));
  const client = createChannelsClient({ transport });

  const seen: unknown[] = [];
  for await (const msg of client.streamMessages("INGRESS-acme", {
    accountId: "acc-1",
    limit: 50,
    mode: "tail",
  })) {
    seen.push(msg);
  }

  assert.equal(
    calls[0]!.path,
    "/channels/streams/INGRESS-acme/messages?accountId=acc-1&limit=50&mode=tail"
  );
  assert.deepEqual(seen, items);
});

test("listUsage() GETs /channels/usage with required from/to and unwraps { items }", async () => {
  const items = [
    {
      bucket: "2026-07-04T00:00:00.000Z",
      accountId: "acc-1",
      channel: "http",
      direction: "ingress" as const,
      events: 5,
    },
  ];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { items },
  }));
  const client = createChannelsClient({ transport });

  const seen: unknown[] = [];
  for await (const row of client.listUsage({
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-04T00:00:00.000Z",
    bucket: "day",
  })) {
    seen.push(row);
  }

  assert.equal(
    calls[0]!.path,
    "/channels/usage?from=2026-07-01T00%3A00%3A00.000Z&to=2026-07-04T00%3A00%3A00.000Z&bucket=day"
  );
  assert.deepEqual(seen, items);
});

test("listUsageTotals() GETs /channels/usage/totals with required from/to and unwraps { items }", async () => {
  const items = [
    {
      direction: "egress" as const,
      events: 3,
      firstTs: "2026-07-01T00:00:00.000Z",
      lastTs: "2026-07-04T00:00:00.000Z",
    },
  ];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { items },
  }));
  const client = createChannelsClient({ transport });

  const seen: unknown[] = [];
  for await (const row of client.listUsageTotals({
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-04T00:00:00.000Z",
    accountId: "acc-1",
  })) {
    seen.push(row);
  }

  assert.ok(calls[0]!.path.startsWith("/channels/usage/totals?"));
  assert.ok(calls[0]!.path.includes("accountId=acc-1"));
  assert.deepEqual(seen, items);
});

test("usageSummary() GETs /channels/usage/summary and returns the 24h rolling summary", async () => {
  const summary = {
    windowHours: 24 as const,
    total: { ingress: 10, egress: 4, dlq: 0 },
    byChannel: [
      { channel: "http", ingress: 10, egress: 4, dlq: 0 },
    ],
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: summary,
  }));
  const client = createChannelsClient({ transport });

  const result = await client.usageSummary();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/channels/usage/summary");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, summary);
});
