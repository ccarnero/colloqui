import assert from "node:assert/strict";
import { test } from "node:test";
import { createTransport } from "../../src/core/transport.js";
import {
  AuthError,
  ConfigError,
  ConflictError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  SdkError,
} from "../../src/domain/errors.js";
import type { FetchResponseLike } from "../../src/infrastructure/http.js";

function fakeResponse({
  status = 200,
  body = "" as unknown,
  headers,
}: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
} = {}): FetchResponseLike {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
    headers: headers
      ? { get: (name) => headers[name.toLowerCase()] ?? null }
      : undefined,
  };
}

function fakeSession(token = "tok-1") {
  const calls = { ensureToken: 0 };
  return {
    session: {
      ensureToken: async () => {
        calls.ensureToken++;
        return { accessToken: token, expiresAt: Date.now() + 3_600_000 };
      },
      getToken: () => null,
    },
    calls,
  };
}

test("builds the unversioned /api prefix by default and injects tenant/request-id headers", async () => {
  let captured: any;
  const fetchImpl = async (url: string, opts: any) => {
    captured = { url, opts };
    return fakeResponse({ body: { ok: true } });
  };
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
  });
  const res = await transport.request<{ ok: boolean }>({
    path: "/channels/accounts?channel=http",
    auth: false,
  });

  assert.equal(captured.url, "http://x/api/channels/accounts?channel=http");
  assert.equal(captured.opts.headers["x-yoizen-tenant"], "acme");
  assert.equal(typeof captured.opts.headers["x-request-id"], "string");
  assert.ok(captured.opts.headers["x-request-id"].length > 0);
  assert.equal(res.body.ok, true);
});

test("apiVersion: 'v1' switches to the /api/v1 prefix", async () => {
  let capturedUrl = "";
  const fetchImpl = async (url: string) => {
    capturedUrl = url;
    return fakeResponse({ body: {} });
  };
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
    apiVersion: "v1",
  });
  await transport.request({ path: "/workflows", auth: false });
  assert.equal(capturedUrl, "http://x/api/v1/workflows");
});

test("honors a per-call requestId override instead of generating one", async () => {
  let captured: any;
  const fetchImpl = async (url: string, opts: any) => {
    captured = opts;
    return fakeResponse({ body: {} });
  };
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
  });
  await transport.request({
    path: "/x",
    auth: false,
    requestId: "fixed-id",
  });
  assert.equal(captured.headers["x-request-id"], "fixed-id");
});

test("injects Authorization from a bound session when auth is required", async () => {
  let captured: any;
  const fetchImpl = async (url: string, opts: any) => {
    captured = opts;
    return fakeResponse({ body: {} });
  };
  const { session, calls } = fakeSession("session-tok");
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
    session,
  });
  await transport.request({ path: "/x" }); // auth defaults to true (session bound)
  assert.equal(captured.headers.Authorization, "Bearer session-tok");
  assert.equal(calls.ensureToken, 1);
});

test("an explicit per-call token overrides the bound session", async () => {
  let captured: any;
  const fetchImpl = async (url: string, opts: any) => {
    captured = opts;
    return fakeResponse({ body: {} });
  };
  const { session, calls } = fakeSession("session-tok");
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
    session,
  });
  await transport.request({ path: "/x", token: "explicit-tok" });
  assert.equal(captured.headers.Authorization, "Bearer explicit-tok");
  assert.equal(calls.ensureToken, 0);
});

test("throws ConfigError when auth: true is forced but no session/token is available", async () => {
  const fetchImpl = async () => fakeResponse({ body: {} });
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
  });
  await assert.rejects(
    () => transport.request({ path: "/x", auth: true }),
    ConfigError
  );
});

test("defaults to unauthenticated when neither auth, session, nor token is given", async () => {
  const fetchImpl = async () => fakeResponse({ body: {} });
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
  });
  const res = await transport.request({ path: "/x" });
  assert.equal(res.status, 200);
});

test("sends Idempotency-Key when idempotencyKey is passed", async () => {
  let captured: any;
  const fetchImpl = async (url: string, opts: any) => {
    captured = opts;
    return fakeResponse({ body: {} });
  };
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
  });
  await transport.request({
    path: "/x",
    method: "POST",
    auth: false,
    idempotencyKey: "idem-1",
  });
  assert.equal(captured.headers["Idempotency-Key"], "idem-1");
});

test("maps HTTP statuses to the typed error taxonomy", async () => {
  const cases: Array<[number, unknown]> = [
    [401, AuthError],
    [403, PermissionError],
    [404, NotFoundError],
    [409, ConflictError],
    [429, RateLimitError],
    [400, SdkError],
  ];
  for (const [status, ctor] of cases) {
    const fetchImpl = async () =>
      fakeResponse({ status, body: { error: "x" } });
    const transport = createTransport({
      fetchImpl,
      baseUrl: "http://x",
      tenant: "acme",
      retry: false,
    });
    await assert.rejects(
      () => transport.request({ path: "/x", auth: false }),
      ctor as new (
        ...args: any[]
      ) => Error
    );
  }
});

test("429 parses Retry-After (seconds) into RateLimitError.retryAfterMs", async () => {
  const fetchImpl = async () =>
    fakeResponse({ status: 429, body: {}, headers: { "retry-after": "2" } });
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
    retry: false,
  });
  await assert.rejects(
    () => transport.request({ path: "/x", auth: false }),
    (err: unknown) => err instanceof RateLimitError && err.retryAfterMs === 2000
  );
});

test("retries a GET on a 503 by default and eventually succeeds", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts++;
    if (attempts < 3) {
      return fakeResponse({ status: 503, body: {} });
    }
    return fakeResponse({ body: { ok: true } });
  };
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
    retry: { baseDelayMs: 1, maxDelayMs: 1 },
  });
  const res = await transport.request<{ ok: boolean }>({
    path: "/x",
    auth: false,
  });
  assert.equal(attempts, 3);
  assert.equal(res.body.ok, true);
});

test("does not retry a POST by default, even on a 503", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts++;
    return fakeResponse({ status: 503, body: {} });
  };
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
  });
  await assert.rejects(() =>
    transport.request({ path: "/x", method: "POST", auth: false })
  );
  assert.equal(attempts, 1);
});

test("requestStream() POSTs with Accept: text/event-stream and injects tenant/request-id/auth headers", async () => {
  let captured: any;
  const fakeBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
  const fetchImpl = async (url: string, opts: any) => {
    captured = { url, opts };
    return {
      status: 200,
      ok: true,
      async text() {
        return "";
      },
      body: fakeBody,
    };
  };
  const { session, calls } = fakeSession("tok-1");
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
    apiVersion: "v1",
    session,
  });

  const res = await transport.requestStream({
    path: "/runtime/executions/stream",
    method: "POST",
    body: { agentId: "a1" },
  });

  assert.equal(captured.url, "http://x/api/v1/runtime/executions/stream");
  assert.equal(captured.opts.headers.Accept, "text/event-stream");
  assert.equal(captured.opts.headers["x-yoizen-tenant"], "acme");
  assert.equal(typeof captured.opts.headers["x-request-id"], "string");
  assert.equal(captured.opts.headers.Authorization, "Bearer tok-1");
  assert.equal(captured.opts.headers["Content-Type"], "application/json");
  assert.equal(captured.opts.body, JSON.stringify({ agentId: "a1" }));
  assert.equal(calls.ensureToken, 1);
  assert.equal(res.status, 200);
  assert.equal(res.body, fakeBody);
});

test("requestStream() throws SdkError(streaming_unsupported) on 404", async () => {
  const fetchImpl = async () =>
    fakeResponse({ status: 404, body: { error: "no route" } });
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
  });

  await assert.rejects(
    () =>
      transport.requestStream({
        path: "/runtime/executions/stream",
        method: "POST",
        auth: false,
      }),
    (err: unknown) =>
      err instanceof SdkError && err.code === "streaming_unsupported"
  );
});

test("requestStream() throws SdkError(streaming_unsupported) on 405", async () => {
  const fetchImpl = async () => fakeResponse({ status: 405, body: {} });
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
  });

  await assert.rejects(
    () =>
      transport.requestStream({
        path: "/runtime/executions/stream",
        method: "POST",
        auth: false,
      }),
    (err: unknown) =>
      err instanceof SdkError && err.code === "streaming_unsupported"
  );
});

test("requestStream() maps a non-404/405 non-2xx status via the shared error taxonomy", async () => {
  const fetchImpl = async () => fakeResponse({ status: 401, body: {} });
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
  });

  await assert.rejects(
    () =>
      transport.requestStream({
        path: "/runtime/executions/stream",
        method: "POST",
        auth: false,
      }),
    AuthError
  );
});

test("requestStream()'s open timeout does not abort an already-open stream", async () => {
  let sawAbortDuringRead = false;
  const fetchImpl = async (_url: string, opts: any) => {
    // Simulate headers arriving well within timeoutMs.
    return {
      status: 200,
      ok: true,
      async text() {
        return "";
      },
      body: new ReadableStream<Uint8Array>({
        async pull(controller) {
          // Wait past the connection-open timeoutMs, then check that the
          // signal used to open the connection was NOT aborted by the timer.
          await new Promise((resolve) => setTimeout(resolve, 30));
          if (opts.signal.aborted) {
            sawAbortDuringRead = true;
          }
          controller.close();
        },
      }),
    };
  };
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
  });

  const res = await transport.requestStream({
    path: "/runtime/executions/stream",
    method: "POST",
    auth: false,
    timeoutMs: 5,
  });
  const reader = res.body!.getReader();
  await reader.read();

  assert.equal(
    sawAbortDuringRead,
    false,
    "the connection-open timeout must not fire once headers have arrived"
  );
});

test("retries a POST when an idempotencyKey is passed", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts++;
    if (attempts < 2) {
      return fakeResponse({ status: 503, body: {} });
    }
    return fakeResponse({ body: { ok: true } });
  };
  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
    retry: { baseDelayMs: 1, maxDelayMs: 1 },
  });
  const res = await transport.request<{ ok: boolean }>({
    path: "/x",
    method: "POST",
    auth: false,
    idempotencyKey: "idem-1",
  });
  assert.equal(attempts, 2);
  assert.equal(res.body.ok, true);
});
