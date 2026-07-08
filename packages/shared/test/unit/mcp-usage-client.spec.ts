import { afterEach, describe, expect, it, mock } from "bun:test";
import type { IMcpUsageEvent } from "../../src/mcp-usage.interfaces";
import { reportMcpUsageEvent } from "../../src/mcp-usage-client";

const AGENT_ADMIN_URL = "http://agent-admin-service.internal";

function buildEvent(overrides: Partial<IMcpUsageEvent> = {}): IMcpUsageEvent {
  return {
    eventId: "event-1",
    tenantId: "tenant-1",
    serverName: "github-mcp",
    toolName: "list_issues",
    success: true,
    durationMs: 42,
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("reportMcpUsageEvent", () => {
  it("posts the event to the usage-events endpoint on first success, without retrying", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const event = buildEvent();
    await new Promise<void>((resolve) => {
      // No onError is invoked on success, so poll the mock instead — a
      // single successful attempt resolves synchronously enough that one
      // microtask flush is sufficient in practice; give it a tick to be safe.
      reportMcpUsageEvent(AGENT_ADMIN_URL, event);
      setTimeout(resolve, 10);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AGENT_ADMIN_URL}/admin/mcp-servers/usage-events`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ eventId: "event-1" });
    // tenantId travels only in the header — the write endpoint's DTO
    // rejects unknown body properties (forbidNonWhitelisted).
    expect(body).not.toHaveProperty("tenantId");
    expect(new Headers(init.headers).get("x-yoizen-tenant")).toBe("tenant-1");
  });

  it("retries on failure and succeeds without calling onError once a later attempt succeeds", async () => {
    let attempt = 0;
    const fetchMock = mock(async () => {
      attempt++;
      if (attempt < 3) {
        throw new Error("network down");
      }
      return new Response(null, { status: 202 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const onError = mock(() => {});
    const event = buildEvent({ eventId: "event-retry-success" });

    // Wait past the two backoff delays (200ms + 400ms) for the 3rd attempt
    // to land, then confirm no terminal failure was ever reported.
    await new Promise<void>((resolve) => {
      reportMcpUsageEvent(AGENT_ADMIN_URL, event, onError);
      setTimeout(resolve, 900);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
    // Every retry resends the SAME idempotency key — no new id minted per attempt.
    for (const call of fetchMock.mock.calls) {
      const [, init] = call as [string, RequestInit];
      expect(JSON.parse(init.body as string).eventId).toBe(
        "event-retry-success"
      );
    }
  });

  it("gives up after the retry budget is exhausted and reports the final failure via onError", async () => {
    const fetchMock = mock(async () => {
      throw new Error("network down");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const event = buildEvent({ eventId: "event-exhausted" });
    const lastError = await new Promise<unknown>((resolve) => {
      reportMcpUsageEvent(AGENT_ADMIN_URL, event, resolve);
    });

    // 3 attempts total (1 initial + 2 retries), matching the documented
    // bounded retry budget.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(lastError).toBeInstanceOf(Error);
    expect((lastError as Error).message).toContain("network down");
  });

  it("treats a non-2xx response as a failure worth retrying", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const event = buildEvent({ eventId: "event-http-500" });
    const lastError = await new Promise<unknown>((resolve) => {
      reportMcpUsageEvent(AGENT_ADMIN_URL, event, resolve);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((lastError as Error).message).toContain("500");
  });

  it("never throws synchronously, even when fetch itself is unavailable", () => {
    globalThis.fetch = (() => {
      throw new Error("fetch is not defined");
    }) as unknown as typeof fetch;

    expect(() =>
      reportMcpUsageEvent(AGENT_ADMIN_URL, buildEvent())
    ).not.toThrow();
  });
});
