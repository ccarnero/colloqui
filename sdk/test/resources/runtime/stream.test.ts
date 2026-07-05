import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportStreamRequestOptions,
  TransportStreamResponse,
} from "../../../src/core/transport.js";
import { SdkError } from "../../../src/domain/errors.js";
import { createRuntimeClient } from "../../../src/resources/runtime/client.js";

/** Builds a `ReadableStream<Uint8Array>` from raw SSE-wire-format string chunks. */
function sseStreamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]!));
      i++;
    },
  });
}

function fakeStreamTransport(
  handler: (
    call: TransportStreamRequestOptions
  ) => TransportStreamResponse | Promise<TransportStreamResponse>
): { transport: Transport; calls: TransportStreamRequestOptions[] } {
  const calls: TransportStreamRequestOptions[] = [];
  const transport: Transport = {
    async request() {
      throw new Error("request() should not be called by stream()");
    },
    async requestStream(options) {
      calls.push(options);
      return handler(options);
    },
  };
  return { transport, calls };
}

test("stream() POSTs /runtime/executions/stream with the input body", async () => {
  const { transport, calls } = fakeStreamTransport(() => ({
    status: 200,
    body: sseStreamOf([
      'event: started\ndata: {"executionId":"ex-1","state":"started"}\n\n',
      'event: completed\ndata: {"executionId":"ex-1","state":"completed"}\n\n',
    ]),
  }));
  const client = createRuntimeClient({ transport });

  const events = [];
  for await (const ev of client.stream({ agentId: "agent-1", message: "hi" })) {
    events.push(ev);
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/runtime/executions/stream");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, { agentId: "agent-1", message: "hi" });
  assert.equal(events.length, 2);
  assert.equal(events[0]!.type, "started");
  assert.equal(events[1]!.type, "completed");
});

test("started -> token* -> completed flow yields events in order", async () => {
  const { transport } = fakeStreamTransport(() => ({
    status: 200,
    body: sseStreamOf([
      'event: started\ndata: {"executionId":"ex-1","state":"started"}\n\n',
      'event: token\ndata: {"executionId":"ex-1","agentId":"a1","seq":1,"delta":"Hel","done":false}\n\n',
      'event: token\ndata: {"executionId":"ex-1","agentId":"a1","seq":2,"delta":"lo","done":true}\n\n',
      'event: completed\ndata: {"executionId":"ex-1","state":"completed","result":{"reply":"Hello"}}\n\n',
    ]),
  }));
  const client = createRuntimeClient({ transport });

  const types: string[] = [];
  let concatenated = "";
  for await (const ev of client.stream({ agentId: "agent-1", message: "hi" })) {
    types.push(ev.type);
    if (ev.type === "token") {
      concatenated += ev.data.delta;
    }
  }

  assert.deepEqual(types, ["started", "token", "token", "completed"]);
  assert.equal(concatenated, "Hello");
});

test("failed event ends iteration without throwing", async () => {
  const { transport } = fakeStreamTransport(() => ({
    status: 200,
    body: sseStreamOf([
      'event: started\ndata: {"executionId":"ex-1","state":"started"}\n\n',
      'event: failed\ndata: {"executionId":"ex-1","reason":"slow_consumer"}\n\n',
    ]),
  }));
  const client = createRuntimeClient({ transport });

  const events = [];
  for await (const ev of client.stream({ agentId: "agent-1", message: "hi" })) {
    events.push(ev);
  }

  assert.equal(events.length, 2);
  assert.equal(events[1]!.type, "failed");
  assert.deepEqual(events[1]!.data, {
    executionId: "ex-1",
    reason: "slow_consumer",
  });
});

test("heartbeat comment lines are ignored and produce no spurious events", async () => {
  const { transport } = fakeStreamTransport(() => ({
    status: 200,
    body: sseStreamOf([
      ":hb\n\n",
      'event: started\ndata: {"executionId":"ex-1","state":"started"}\n\n',
      ":hb\n\n",
      'event: completed\ndata: {"executionId":"ex-1","state":"completed"}\n\n',
      ":hb\n\n",
    ]),
  }));
  const client = createRuntimeClient({ transport });

  const events = [];
  for await (const ev of client.stream({ agentId: "agent-1", message: "hi" })) {
    events.push(ev);
  }

  assert.equal(events.length, 2);
});

test("aborting mid-stream ends the iterator cleanly (no throw)", async () => {
  const controller = new AbortController();
  const { transport } = fakeStreamTransport(() => ({
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(streamController) {
        const encoder = new TextEncoder();
        streamController.enqueue(
          encoder.encode(
            'event: started\ndata: {"executionId":"ex-1","state":"started"}\n\n'
          )
        );
        // Simulate an abort happening mid-stream instead of ever sending
        // `completed` — the reader's next `read()` should reject with an
        // AbortError once the signal fires.
        controller.abort();
      },
      async pull(streamController) {
        const err = new Error("aborted");
        err.name = "AbortError";
        streamController.error(err);
      },
    }),
  }));
  const client = createRuntimeClient({ transport });

  const events = [];
  for await (const ev of client.stream(
    { agentId: "agent-1", message: "hi" },
    { signal: controller.signal }
  )) {
    events.push(ev);
  }

  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, "started");
});

test("404 opening the stream throws SdkError with code streaming_unsupported", async () => {
  const { transport } = fakeStreamTransport(() => {
    throw new SdkError("streaming is not supported by this gateway/version", {
      code: "streaming_unsupported",
      details: { httpStatus: 404 },
    });
  });
  const client = createRuntimeClient({ transport });

  await assert.rejects(
    async () => {
      for await (const _ev of client.stream({
        agentId: "agent-1",
        message: "hi",
      })) {
        // no-op
      }
    },
    (err: unknown) =>
      err instanceof SdkError && err.code === "streaming_unsupported"
  );
});
