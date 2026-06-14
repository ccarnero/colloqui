import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthAdapter } from "../../src/infrastructure/auth-adapter.js";
import { AuthError } from "../../src/domain/errors.js";

function res({ status = 200, body }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return JSON.stringify(body);
    },
  };
}

const clock = { now: () => 1000 };

test("login posts email/password/tenant_id and maps the token", async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return res({
      body: {
        access_token: "a",
        expires_in: 3600,
        refresh_token: "r",
        scope: "tenant:acme",
      },
    });
  };
  const auth = createAuthAdapter({ fetchImpl, baseUrl: "http://x", timeoutMs: 50, clock });
  const token = await auth.login({ email: "e@x.com", password: "p", tenant: "acme" });

  assert.equal(captured.url, "http://x/api/auth/login");
  assert.deepEqual(JSON.parse(captured.opts.body), {
    email: "e@x.com",
    password: "p",
    tenant_id: "acme",
  });
  assert.equal(captured.opts.headers.Authorization, undefined); // login is unauthenticated
  assert.equal(token.accessToken, "a");
  assert.equal(token.expiresAt, 1000 + 3600 * 1000);
});

test("login throws AuthError on a non-2xx response", async () => {
  const fetchImpl = async () => res({ status: 401, body: { error: "bad" } });
  const auth = createAuthAdapter({ fetchImpl, baseUrl: "http://x", timeoutMs: 50, clock });
  await assert.rejects(
    () => auth.login({ email: "e@x.com", password: "p", tenant: "t" }),
    (err) => err instanceof AuthError && err.details.httpStatus === 401,
  );
});

test("refresh posts the refresh_token", async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return res({ body: { access_token: "a2", expires_in: 3600 } });
  };
  const auth = createAuthAdapter({ fetchImpl, baseUrl: "http://x", timeoutMs: 50, clock });
  const token = await auth.refresh("rt");

  assert.equal(captured.url, "http://x/api/auth/refresh");
  assert.deepEqual(JSON.parse(captured.opts.body), { refresh_token: "rt" });
  assert.equal(token.accessToken, "a2");
});
