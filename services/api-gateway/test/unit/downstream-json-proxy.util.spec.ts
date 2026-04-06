import "reflect-metadata";
import { describe, it, expect, mock, afterEach } from "bun:test";
import { TENANT_HEADER } from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { PROXY_TIMEOUT_MS } from "../../src/constants";
import {
  downstreamJsonProxy,
  createTenantJsonProxyForwarder,
} from "../../src/utils/downstream-json-proxy.util";

describe("downstreamJsonProxy", () => {
  const originalFetch = globalThis.fetch;
  const logger = new PinoLoggerService("test");

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns parsed JSON on 200", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, data: 1 }),
      }),
    ) as typeof fetch;

    const out = await downstreamJsonProxy({
      baseUrl: "http://svc",
      method: "GET",
      path: "/x",
      tenantId: "t1",
      serviceLabel: "test",
      logger,
    });
    expect(out).toEqual({ ok: true, data: 1 });
  });

  it("returns empty object on 204", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 204,
        json: () => Promise.reject(new Error("no body")),
      }),
    ) as typeof fetch;

    const out = await downstreamJsonProxy({
      baseUrl: "http://svc",
      method: "DELETE",
      path: "/x",
      tenantId: "t1",
      serviceLabel: "test",
      logger,
    });
    expect(out).toEqual({});
  });

  it("sets tenant header and query string", async () => {
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      }),
    ) as typeof fetch;
    globalThis.fetch = fetchMock;

    await downstreamJsonProxy({
      baseUrl: "http://svc",
      method: "GET",
      path: "/path",
      tenantId: "tenant-a",
      query: { a: "1", b: undefined },
      serviceLabel: "test",
      logger,
    });

    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("http://svc/path?a=1");
    const h = init?.headers as Record<string, string>;
    expect(h[TENANT_HEADER]).toBe("tenant-a");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("defaults AbortSignal timeout when signal omitted", async () => {
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      }),
    ) as typeof fetch;
    globalThis.fetch = fetchMock;

    await downstreamJsonProxy({
      baseUrl: "http://svc",
      method: "GET",
      path: "/z",
      tenantId: "t",
      serviceLabel: "test",
      logger,
    });

    const [, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect((init?.signal as AbortSignal).aborted).toBe(false);
    expect(PROXY_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("createTenantJsonProxyForwarder", () => {
  const originalFetch = globalThis.fetch;
  const logger = new PinoLoggerService("test");

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("delegates to downstreamJsonProxy with fixed base URL", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [] }),
      }),
    ) as typeof fetch;

    const forward = createTenantJsonProxyForwarder(
      "http://downstream",
      "ds",
      logger,
    );
    const out = await forward({
      method: "GET",
      path: "/list",
      tenantId: "t9",
    });
    expect(out).toEqual({ items: [] });
  });
});
