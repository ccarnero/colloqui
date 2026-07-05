import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";
import type { FastifyReply } from "fastify";
import { pipeUpstreamSseToReply } from "../../src/utils/pipe-upstream-sse-to-reply.util";

/**
 * A minimal fake of Fastify's `reply.raw` (Node's `http.ServerResponse`) —
 * enough surface for the util: writeHead/write/end/destroyed/writable, plus
 * EventEmitter's on/off for the 'close' listener.
 */
class FakeRawResponse extends EventEmitter {
  writeHeadCalls: Array<[number, Record<string, string>]> = [];
  writes: Array<string | Uint8Array> = [];
  destroyed = false;
  writable = true;
  ended = false;

  writeHead(status: number, headers: Record<string, string>): void {
    this.writeHeadCalls.push([status, headers]);
  }

  write(chunk: string | Uint8Array): boolean {
    this.writes.push(chunk);
    return true;
  }

  end(): void {
    this.ended = true;
  }
}

function makeReply(raw: FakeRawResponse): FastifyReply {
  return {
    hijack: mock(() => {}),
    raw,
  } as unknown as FastifyReply;
}

function sseUpstreamResponse(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status });
}

describe("pipeUpstreamSseToReply", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Real timers are fine — HEARTBEAT_INTERVAL_MS is 15s, far beyond test duration.
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("hijacks the reply before doing anything else", async () => {
    const raw = new FakeRawResponse();
    const reply = makeReply(raw);
    globalThis.fetch = mock(() =>
      Promise.resolve(sseUpstreamResponse(["data: hi\n\n"]))
    ) as unknown as typeof fetch;

    await pipeUpstreamSseToReply(reply, {
      upstreamUrl: "http://upstream/runtime/executions/stream",
      headers: { "x-yoizen-tenant": "acme" },
      body: { agentId: "a1", message: "hi" },
    });

    expect(reply.hijack).toHaveBeenCalledTimes(1);
  });

  it("writes SSE headers (content-type, cache-control, connection, no-buffering)", async () => {
    const raw = new FakeRawResponse();
    const reply = makeReply(raw);
    globalThis.fetch = mock(() =>
      Promise.resolve(sseUpstreamResponse(["data: hi\n\n"]))
    ) as unknown as typeof fetch;

    await pipeUpstreamSseToReply(reply, {
      upstreamUrl: "http://upstream/runtime/executions/stream",
      headers: {},
      body: {},
    });

    expect(raw.writeHeadCalls.length).toBe(1);
    const [status, headers] = raw.writeHeadCalls[0]!;
    expect(status).toBe(200);
    expect(headers["Content-Type"]).toBe("text/event-stream");
    expect(headers["Cache-Control"]).toBe("no-cache");
    expect(headers.Connection).toBe("keep-alive");
    expect(headers["X-Accel-Buffering"]).toBe("no");
  });

  it("pipes each upstream chunk to reply.raw without buffering the whole body", async () => {
    const raw = new FakeRawResponse();
    const reply = makeReply(raw);
    globalThis.fetch = mock(() =>
      Promise.resolve(
        sseUpstreamResponse([
          "event: started\ndata: {}\n\n",
          "event: token\ndata: {}\n\n",
        ])
      )
    ) as unknown as typeof fetch;

    await pipeUpstreamSseToReply(reply, {
      upstreamUrl: "http://upstream/runtime/executions/stream",
      headers: {},
      body: {},
    });

    expect(raw.writes.length).toBe(2);
    const decoded = raw.writes.map((w) =>
      new TextDecoder().decode(w as Uint8Array)
    );
    expect(decoded[0]).toContain("event: started");
    expect(decoded[1]).toContain("event: token");
  });

  it("forwards tenant/trusted-user headers and sets Accept: text/event-stream on the upstream request", async () => {
    const raw = new FakeRawResponse();
    const reply = makeReply(raw);
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(sseUpstreamResponse(["data: hi\n\n"]));
    }) as unknown as typeof fetch;

    await pipeUpstreamSseToReply(reply, {
      upstreamUrl: "http://upstream/runtime/executions/stream",
      headers: { "x-yoizen-tenant": "acme", "x-yoizen-user-id": "user-1" },
      body: { agentId: "a1", message: "hi" },
    });

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-yoizen-tenant"]).toBe("acme");
    expect(headers["x-yoizen-user-id"]).toBe("user-1");
    expect(headers.accept).toBe("text/event-stream");
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      agentId: "a1",
      message: "hi",
    });
  });

  it("aborts the upstream fetch when reply.raw emits 'close' (client disconnect propagation, §2.2)", async () => {
    const raw = new FakeRawResponse();
    const reply = makeReply(raw);

    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      // Never resolves within the test window; we assert abort directly.
      return new Promise(() => {});
    }) as unknown as typeof fetch;

    const pending = pipeUpstreamSseToReply(reply, {
      upstreamUrl: "http://upstream/runtime/executions/stream",
      headers: {},
      body: {},
    });

    // Let fetch() be called.
    await Promise.resolve();
    await Promise.resolve();

    expect(capturedSignal?.aborted).toBe(false);
    raw.emit("close");
    expect(capturedSignal?.aborted).toBe(true);

    void pending; // never resolves in this test — fetch never returns.
  });

  it("writes a terminal failed event when the upstream response is not ok", async () => {
    const raw = new FakeRawResponse();
    const reply = makeReply(raw);
    globalThis.fetch = mock(() =>
      Promise.resolve(sseUpstreamResponse([], 500))
    ) as unknown as typeof fetch;

    await pipeUpstreamSseToReply(reply, {
      upstreamUrl: "http://upstream/runtime/executions/stream",
      headers: {},
      body: {},
    });

    const decoded = raw.writes
      .map((w) => (typeof w === "string" ? w : new TextDecoder().decode(w)))
      .join("");
    expect(decoded).toContain("event: failed");
  });

  it("ends the raw response after the upstream stream completes", async () => {
    const raw = new FakeRawResponse();
    const reply = makeReply(raw);
    globalThis.fetch = mock(() =>
      Promise.resolve(sseUpstreamResponse(["data: hi\n\n"]))
    ) as unknown as typeof fetch;

    await pipeUpstreamSseToReply(reply, {
      upstreamUrl: "http://upstream/runtime/executions/stream",
      headers: {},
      body: {},
    });

    expect(raw.ended).toBe(true);
  });
});
