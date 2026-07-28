import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  ICachedHttpResponseEntry,
  IHttpResponseCache,
} from "../../src/activities/_shared/http-cache/http-response-cache";
import { setActivePublishSpy } from "../helpers/fake-nats-jetstream";
import {
  setActiveTracedFetch,
  type TracedFetchImpl,
} from "../helpers/fake-traced-fetch";

// `tracedFetch` is routed through the SHARED `"@yoizen/observability"` double
// (`test/helpers/fake-traced-fetch`) instead of a private `mock.module(...)`
// here — see that helper's doc comment: multiple spec files exercise the
// same process-wide binding, so a private mock would race other spec files.
const tracedFetchMock: ReturnType<typeof mock> = mock(() =>
  Promise.resolve(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
);
setActiveTracedFetch(tracedFetchMock as unknown as TracedFetchImpl);

const { executeRaw } = await import(
  "../../src/lib/endpoint-call-core/execute-raw"
);
// See `service-call.activity.spec.ts` / `fake-nats-jetstream.ts` doc
// comments: `event-publisher.ts` is an ES module singleton evaluated once
// across the whole `bun test` process, so the shared `"nats"` double + a
// mutable publish-spy indirection is required instead of a private
// `mock.module("nats", ...)` in this file. This is the SAME real
// `publishEndpointCallEvent` sink `service-call.activity.ts` and
// `endpoint-call.activity.ts` use, so redaction/truncation/causal-threading/
// fire-and-forget semantics are exercised end-to-end, not just at the core
// level.
const { publishEndpointCallEvent } = await import(
  "../../src/activities/_shared/event-publisher"
);

/**
 * Isolated in-memory cache, same pattern as `endpoint-call-core.spec.ts` —
 * avoids touching the `getHttpResponseCache()` process-wide singleton.
 */
function makeCache(): IHttpResponseCache {
  const store = new Map<string, ICachedHttpResponseEntry>();
  return {
    get: (key) => Promise.resolve(store.get(key) ?? null),
    setex: (key, _ttl, entry) => {
      store.set(key, entry);
      return Promise.resolve();
    },
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function decodePublishedPayload(
  publishSpy: ReturnType<typeof mock>
): Record<string, unknown> {
  const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
  const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
    resource: string;
    data: { payload: Record<string, unknown> };
  };
  return { ...envelope.data.payload, __resource: envelope.resource };
}

describe("executeRaw — endpoint_call_completed emission (T02)", () => {
  let publishSpy: ReturnType<typeof mock>;

  beforeEach(() => {
    publishSpy = mock(async () => ({ seq: 1 }));
    setActivePublishSpy(publishSpy);
    setActiveTracedFetch(tracedFetchMock as unknown as TracedFetchImpl);
    tracedFetchMock.mockReset();
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
  });

  it("publishes with resource raw/<host> on a successful (2xx) call", async () => {
    const result = await executeRaw(
      { method: "GET", url: "https://raw-target.example.com/ping" },
      "t1",
      makeCache(),
      undefined,
      publishEndpointCallEvent
    );
    await flush();

    expect(result.ok).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const payload = decodePublishedPayload(publishSpy);
    expect(payload["__resource"]).toBe("raw/raw-target.example.com");
    expect(payload["status"]).toBe(200);
  });

  it("publishes with resource raw/<host> when upstream returns a non-2xx status", async () => {
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const result = await executeRaw(
      { method: "GET", url: "https://raw-target.example.com/missing" },
      "t1",
      makeCache(),
      undefined,
      publishEndpointCallEvent
    );
    await flush();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(404);
    }
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const payload = decodePublishedPayload(publishSpy);
    expect(payload["status"]).toBe(404);
    expect(payload["__resource"]).toBe("raw/raw-target.example.com");
  });

  it("redacts sensitive request headers before publishing", async () => {
    await executeRaw(
      {
        method: "GET",
        url: "https://raw-target.example.com/ping",
        headers: { Authorization: "Bearer super-secret-token" },
      },
      "t1",
      makeCache(),
      undefined,
      publishEndpointCallEvent
    );
    await flush();

    const payload = decodePublishedPayload(publishSpy);
    const requestHeaders = payload["requestHeaders"] as Record<string, string>;
    expect(requestHeaders["Authorization"]).toBe("[REDACTED]");
  });

  it("truncates an oversized response body before publishing", async () => {
    const bigValue = "x".repeat(9000);
    tracedFetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ big: bigValue }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await executeRaw(
      { method: "GET", url: "https://raw-target.example.com/ping" },
      "t1",
      makeCache(),
      undefined,
      publishEndpointCallEvent
    );
    await flush();

    const payload = decodePublishedPayload(publishSpy);
    const responseBody = payload["responseBody"] as string;
    expect(responseBody.length).toBe(8192);
  });

  it("threads causal context through to the published envelope", async () => {
    const causal = {
      correlation_id: "run-correlation-id",
      causation_id: "parent-event-id",
      depth: 1,
    };

    await executeRaw(
      { method: "GET", url: "https://raw-target.example.com/ping" },
      "t1",
      makeCache(),
      causal,
      publishEndpointCallEvent
    );
    await flush();

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      correlation_id: string;
      causation_id: string | null;
      transport: { depth: number };
    };
    expect(envelope.correlation_id).toBe("run-correlation-id");
    expect(envelope.causation_id).toBe("parent-event-id");
    expect(envelope.transport.depth).toBe(2);
  });

  it("publishes a root event when no causal context is passed", async () => {
    await executeRaw(
      { method: "GET", url: "https://raw-target.example.com/ping" },
      "t1",
      makeCache(),
      undefined,
      publishEndpointCallEvent
    );
    await flush();

    const rawBytes = publishSpy.mock.calls[0]![1] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      causation_id: string | null;
      transport: { depth: number };
    };
    expect(envelope.causation_id).toBeNull();
    expect(envelope.transport.depth).toBe(0);
  });

  it("does not throw when the publish sink rejects (fire-and-forget)", async () => {
    publishSpy.mockImplementationOnce(async () => {
      throw new Error("NATS unavailable");
    });

    let caught: unknown = null;
    try {
      await executeRaw(
        { method: "GET", url: "https://raw-target.example.com/ping" },
        "t1",
        makeCache(),
        undefined,
        publishEndpointCallEvent
      );
    } catch (err) {
      caught = err;
    }
    await flush();

    expect(caught).toBeNull();
  });

  it("does not publish when the raw url is invalid (relative url, no fetch attempted)", async () => {
    const result = await executeRaw(
      { method: "GET", url: "/relative" },
      "t1",
      makeCache(),
      undefined,
      publishEndpointCallEvent
    );
    await flush();

    expect(result.ok).toBe(false);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("does not publish when the network call itself fails", async () => {
    tracedFetchMock.mockImplementation(() =>
      Promise.reject(new Error("network unreachable"))
    );

    const result = await executeRaw(
      { method: "GET", url: "https://raw-target.example.com/ping" },
      "t1",
      makeCache(),
      undefined,
      publishEndpointCallEvent
    );
    await flush();

    expect(result.ok).toBe(false);
    expect(publishSpy).not.toHaveBeenCalled();
  });
});
