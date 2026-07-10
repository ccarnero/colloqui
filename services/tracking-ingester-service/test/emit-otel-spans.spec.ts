// Tests for the OTLP/HTTP JSON span exporter (T2 of
// .sdd/changes/trace-visualization/tasks.md). `fetch` is mocked so every case
// runs offline. Export is fire-and-forget by design: the ingest path (buffer
// flush) MUST NOT fail because Tempo/collector is unreachable, so
// `emitOtelSpans` never throws and always resolves — it reports failure via a
// logged line + a `Result` for callers who care, but the buffer's own
// insert-then-emit wiring (tracked-event-buffer.spec.ts) proves the insert
// waiters resolve regardless of the emit outcome.

import { describe, expect, it } from "bun:test";
import { emitOtelSpans } from "../src/lib/emit-otel-spans.js";
import type { OtelSpan } from "../src/lib/to-otel-span.js";

function span(overrides: Partial<OtelSpan> = {}): OtelSpan {
  return {
    trace_id: "11111111111111111111111111111111".slice(0, 32),
    span_id: "aaaaaaaaaaaaaaaa",
    service_name: "channel-service",
    name: "telegram.ingress",
    start_time_unix_nano: "1000000000",
    end_time_unix_nano: "1000000000",
    duration_ms: 0,
    attributes: {
      tech: "telegram",
      business_fn: "ingress",
      is_claim_check: false,
      compliance: "full",
      tenant: "acme",
    },
    ...overrides,
  };
}

describe("emitOtelSpans — disabled emitter (no endpoint)", () => {
  it("is a no-op and never calls fetch when endpoint is undefined", async () => {
    let called = false;
    const fakeFetch = async () => {
      called = true;
      return new Response(null, { status: 200 });
    };
    const result = await emitOtelSpans(undefined, [span()], fakeFetch);
    expect(result.ok).toBe(true);
    expect(called).toBe(false);
  });
});

describe("emitOtelSpans — enabled emitter", () => {
  it("posts a correct OTLP/HTTP JSON envelope shape (resourceSpans/scopeSpans)", async () => {
    let capturedBody: unknown;
    let capturedUrl: string | undefined;
    const fakeFetch = async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(init?.body));
      return new Response(null, { status: 200 });
    };

    const result = await emitOtelSpans(
      "http://otel-collector.dev:4318/v1/traces",
      [span()],
      fakeFetch
    );

    expect(result.ok).toBe(true);
    expect(capturedUrl).toBe("http://otel-collector.dev:4318/v1/traces");
    const body = capturedBody as {
      resourceSpans: Array<{
        resource: { attributes: Array<{ key: string; value: unknown }> };
        scopeSpans: Array<{ spans: unknown[] }>;
      }>;
    };
    expect(Array.isArray(body.resourceSpans)).toBe(true);
    expect(body.resourceSpans.length).toBeGreaterThan(0);
    expect(body.resourceSpans[0]?.scopeSpans.length).toBeGreaterThan(0);
    const serviceNameAttr = body.resourceSpans[0]?.resource.attributes.find(
      (a) => a.key === "service.name"
    );
    expect(serviceNameAttr).toBeDefined();
  });

  it("a batch of N events across M services produces N total spans", async () => {
    let capturedBody: unknown;
    const fakeFetch = async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(null, { status: 200 });
    };

    const spans = [
      span({ span_id: "1111111111111111", service_name: "channel-service" }),
      span({ span_id: "2222222222222222", service_name: "channel-service" }),
      span({ span_id: "3333333333333333", service_name: "workflow-service" }),
    ];

    const result = await emitOtelSpans(
      "http://otel-collector.dev:4318/v1/traces",
      spans,
      fakeFetch
    );
    expect(result.ok).toBe(true);

    const body = capturedBody as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: unknown[] }> }>;
    };
    const totalSpans = body.resourceSpans.reduce(
      (sum, rs) =>
        sum + rs.scopeSpans.reduce((s, scope) => s + scope.spans.length, 0),
      0
    );
    expect(totalSpans).toBe(3);
    // Two distinct services → two resourceSpans entries.
    expect(body.resourceSpans.length).toBe(2);
  });

  it("an empty span batch is a no-op — never calls fetch", async () => {
    let called = false;
    const fakeFetch = async () => {
      called = true;
      return new Response(null, { status: 200 });
    };
    const result = await emitOtelSpans(
      "http://otel-collector.dev:4318/v1/traces",
      [],
      fakeFetch
    );
    expect(result.ok).toBe(true);
    expect(called).toBe(false);
  });

  it("export failure (fetch throws) is caught, logged, and returned as err — never thrown", async () => {
    const logs: string[] = [];
    const failingFetch = async () => {
      throw new Error("ECONNREFUSED collector.dev:4318");
    };

    let threw = false;
    let result: Awaited<ReturnType<typeof emitOtelSpans>> | undefined;
    try {
      result = await emitOtelSpans(
        "http://otel-collector.dev:4318/v1/traces",
        [span()],
        failingFetch,
        (msg) => logs.push(msg)
      );
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result?.ok).toBe(false);
    if (!result?.ok) {
      expect(result?.error.reason).toContain("ECONNREFUSED");
    }
    expect(logs.some((l) => l.includes("ECONNREFUSED"))).toBe(true);
  });

  it("export failure (non-2xx HTTP status) is caught, logged, and returned as err", async () => {
    const logs: string[] = [];
    const badStatusFetch = async () =>
      new Response("collector unavailable", { status: 503 });

    const result = await emitOtelSpans(
      "http://otel-collector.dev:4318/v1/traces",
      [span()],
      badStatusFetch,
      (msg) => logs.push(msg)
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toContain("503");
    }
    expect(logs.some((l) => l.includes("503"))).toBe(true);
  });
});
