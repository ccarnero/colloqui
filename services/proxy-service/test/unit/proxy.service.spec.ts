import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { TENANT_HEADER } from "@yoizen/shared";
import { ProxyService } from "../../src/modules/proxy/proxy.service";

describe("ProxyService", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createReply() {
    const r = {
      code: 200 as number,
      body: undefined as unknown,
      status(this: typeof r, c: number) {
        this.code = c;
        return this;
      },
      header(_k: string, _v: string) {
        return r;
      },
      send(this: typeof r, body?: unknown) {
        this.body = body;
        return this;
      },
    };
    return r;
  }

  it("handleYSocial proxies to tenant ySocialUrl", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (url.includes("/tenants/")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              configuration: { ySocialUrl: "https://ys.example" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (url.startsWith("https://ys.example")) {
        return Promise.resolve(new Response("ok-body", { status: 200 }));
      }
      return Promise.resolve(new Response("no", { status: 404 }));
    });

    const service = new ProxyService();
    const reply = createReply();
    const req = {
      headers: { [TENANT_HEADER]: "tenant-1" },
      url: "/proxy/ysocial/api?v=1",
      method: "GET",
      body: undefined,
    } as never;

    await service.handleYSocial(req, reply as never);
    expect(reply.code).toBe(200);
    expect(reply.body).toBe("ok-body");
  });

  it("handleYFlow proxies to tenant yFlowUrl", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (url.includes("/tenants/")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              configuration: { yFlowUrl: "https://flow.example" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (url.startsWith("https://flow.example")) {
        return Promise.resolve(new Response("flow", { status: 201 }));
      }
      return Promise.resolve(new Response("no", { status: 404 }));
    });

    const service = new ProxyService();
    const reply = createReply();
    const req = {
      headers: { [TENANT_HEADER]: "tenant-1" },
      url: "/proxy/yflow/run",
      method: "GET",
      body: undefined,
    } as never;

    await service.handleYFlow(req, reply as never);
    expect(reply.code).toBe(201);
    expect(reply.body).toBe("flow");
  });

  it("handleGeneric returns 400 when x-proxy-target is missing", async () => {
    const service = new ProxyService();
    const reply = createReply();
    const req = {
      headers: {},
      url: "/proxy/generic/foo",
      method: "GET",
      body: undefined,
    } as never;

    await service.handleGeneric(req, reply as never);
    expect(reply.code).toBe(400);
    expect((reply.body as { message?: string }).message).toContain(
      "x-proxy-target",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handleGeneric forwards to x-proxy-target base URL", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response("upstream", { status: 200 })),
    );
    const service = new ProxyService();
    const reply = createReply();
    const req = {
      headers: { "x-proxy-target": "https://upstream.example" },
      url: "/proxy/generic/api/v1?q=1",
      method: "GET",
      body: undefined,
    } as never;

    await service.handleGeneric(req, reply as never);
    expect(reply.code).toBe(200);
    expect(reply.body).toBe("upstream");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("proxyTo returns upstream status and body", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response("hello", { status: 418 })),
    );

    const service = new ProxyService();
    const reply = createReply();
    const req = {
      headers: { "x-custom": "1" },
      url: "/any",
      method: "GET",
      body: undefined,
    } as never;

    await (
      service as unknown as {
        proxyTo: (u: string, req: object, reply: object) => Promise<void>;
      }
    ).proxyTo("https://upstream.test/path", req, reply);

    expect(reply.code).toBe(418);
    expect(reply.body).toBe("hello");
  });
});
