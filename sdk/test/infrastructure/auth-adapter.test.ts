import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../src/core/transport.js";
import { AuthError, SdkError } from "../../src/domain/errors.js";
import { createAuthAdapter } from "../../src/infrastructure/auth-adapter.js";

/**
 * `auth-adapter` now delegates all HTTP concerns to the shared `Transport`
 * (P1.2), so its tests exercise the adapter against a fake `Transport`
 * instead of a fake `fetch`. Behavioral coverage is preserved: the same
 * paths/bodies are asserted, and the same error mapping is verified.
 */
function fakeTransport(
  handler: (
    opts: TransportRequestOptions
  ) => Promise<TransportResponse<unknown>>
): { transport: Transport; calls: TransportRequestOptions[] } {
  const calls: TransportRequestOptions[] = [];
  return {
    transport: {
      request: async (opts) => {
        calls.push(opts);
        return handler(opts) as Promise<TransportResponse<never>>;
      },
    },
    calls,
  };
}

const clock = { now: () => 1000 };

test("login posts email/password/tenant_id (unauthenticated) and maps the token", async () => {
  const { transport, calls } = fakeTransport(async () => ({
    status: 200,
    body: {
      access_token: "a",
      expires_in: 3600,
      refresh_token: "r",
      scope: "tenant:acme",
    },
  }));
  const auth = createAuthAdapter({ transport, clock });
  const token = await auth.login({
    email: "e@x.com",
    password: "p",
    tenant: "acme",
  });

  assert.equal(calls[0].path, "/auth/login");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, {
    email: "e@x.com",
    password: "p",
    tenant_id: "acme",
  });
  assert.equal(calls[0].auth, false); // login is unauthenticated
  assert.equal(token.accessToken, "a");
  assert.equal(token.expiresAt, 1000 + 3600 * 1000);
});

test("login throws AuthError when the transport rejects with a non-2xx status", async () => {
  const { transport } = fakeTransport(async () => {
    throw new AuthError("request failed: unauthorized", {
      details: { httpStatus: 401, body: { error: "bad" } },
    });
  });
  const auth = createAuthAdapter({ transport, clock });
  await assert.rejects(
    () => auth.login({ email: "e@x.com", password: "p", tenant: "t" }),
    (err: unknown) => err instanceof AuthError && err.details.httpStatus === 401
  );
});

test("login throws AuthError for any other transport failure too", async () => {
  const { transport } = fakeTransport(async () => {
    throw new SdkError("request failed with status 500", {
      code: "HTTP",
      details: { httpStatus: 500 },
    });
  });
  const auth = createAuthAdapter({ transport, clock });
  await assert.rejects(
    () => auth.login({ email: "e@x.com", password: "p", tenant: "t" }),
    (err: unknown) => err instanceof AuthError && err.details.httpStatus === 500
  );
});

test("refresh posts the refresh_token, unauthenticated", async () => {
  const { transport, calls } = fakeTransport(async () => ({
    status: 200,
    body: { access_token: "a2", expires_in: 3600 },
  }));
  const auth = createAuthAdapter({ transport, clock });
  const token = await auth.refresh("rt");

  assert.equal(calls[0].path, "/auth/refresh");
  assert.deepEqual(calls[0].body, { refresh_token: "rt" });
  assert.equal(calls[0].auth, false);
  assert.equal(token.accessToken, "a2");
});
