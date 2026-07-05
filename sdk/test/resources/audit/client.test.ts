import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { createAuditClient } from "../../../src/resources/audit/client.js";

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

const sampleEvent = {
  id: "ev-1",
  type: "workflow.executed",
  payload: {},
  metadata: {},
  subject: "workflow:1",
  correlation_id: "corr-1",
  causation_id: null,
  depth: 0,
  created_at: "2026-07-04T00:00:00.000Z",
};

const sampleChannelEvent = {
  id: "ce-1",
  tenantId: "acme",
  channel: "http",
  provider: "http",
  kind: "inbound",
  accountId: "acc-1",
  fromId: null,
  toId: null,
  messageType: null,
  messageText: null,
  providerMessageId: null,
  correlationId: null,
  causationId: null,
  depth: null,
  data: {},
  natsSubject: "audit.channel.http",
  createdAt: "2026-07-04T00:00:00.000Z",
};

test("events.list() GETs /audit/events and paginates via the {events,limit,offset} envelope", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { events: [sampleEvent], limit: 50, offset: 0 },
  }));
  const client = createAuditClient({ transport });

  const seen: unknown[] = [];
  for await (const ev of client.events.list()) {
    seen.push(ev);
  }
  assert.equal(calls[0]!.path, "/audit/events?limit=50&offset=0");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(seen, [sampleEvent]);
});

test("events.list() forwards type/from/to query params", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { events: [], limit: 50, offset: 0 },
  }));
  const client = createAuditClient({ transport });

  await client.events
    .list({ type: "workflow.executed", from: "2026-01-01", to: "2026-07-01" })
    .page();
  assert.equal(
    calls[0]!.path,
    "/audit/events?type=workflow.executed&from=2026-01-01&to=2026-07-01&limit=50&offset=0"
  );
});

test("events.list() sets hasMore=true when a full page is returned (no total in envelope)", async () => {
  const { transport } = fakeTransport(() => ({
    status: 200,
    body: { events: [sampleEvent], limit: 1, offset: 0 },
  }));
  const client = createAuditClient({ transport });

  const page = await client.events.list({ limit: 1 }).page({ limit: 1 });
  assert.equal(page.hasMore, true);
  assert.equal(page.nextOffset, 1);
});

test("events.get() GETs /audit/events/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleEvent,
  }));
  const client = createAuditClient({ transport });

  const result = await client.events.get("ev-1");
  assert.equal(calls[0]!.path, "/audit/events/ev-1");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleEvent);
});

test("channelEvents.list() GETs /audit/channel-events and forwards filters", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { events: [sampleChannelEvent], limit: 50, offset: 0 },
  }));
  const client = createAuditClient({ transport });

  const seen: unknown[] = [];
  for await (const ev of client.channelEvents.list({ channel: "http" })) {
    seen.push(ev);
  }
  assert.equal(
    calls[0]!.path,
    "/audit/channel-events?channel=http&limit=50&offset=0"
  );
  assert.deepEqual(seen, [sampleChannelEvent]);
});

test("channelEvents.get() GETs /audit/channel-events/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleChannelEvent,
  }));
  const client = createAuditClient({ transport });

  const result = await client.channelEvents.get("ce-1");
  assert.equal(calls[0]!.path, "/audit/channel-events/ce-1");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleChannelEvent);
});
