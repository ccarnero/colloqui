import assert from "node:assert/strict";
import { test } from "node:test";
import { createSession } from "../../src/core/session.js";
import { AuthError } from "../../src/domain/errors.js";
import { makeToken } from "../../src/domain/token.js";

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function setup(overrides: Record<string, any> = {}) {
  const clock = overrides.clock ?? fakeClock();
  const calls = { login: 0, refresh: 0 };

  const auth = {
    async login() {
      calls.login++;
      return makeToken({
        accessToken: `tok-${calls.login}`,
        expiresIn: 3600,
        refreshToken: "ref",
        scope: overrides.loginScope ?? "tenant:acme",
        obtainedAt: clock.now(),
      });
    },
    async refresh() {
      calls.refresh++;
      if (overrides.refreshThrows) {
        throw new AuthError("refresh failed");
      }
      return makeToken({
        accessToken: "refreshed",
        expiresIn: 3600,
        refreshToken: "ref2",
        scope: "tenant:acme",
        obtainedAt: clock.now(),
      });
    },
  };

  const config = {
    tenant: "acme",
    email: "ops@acme.com",
    password: "pw",
    tokenExpiryBufferMs: 60_000,
    ...overrides.config,
  };

  const session = createSession({ auth, clock, config });
  return { session, calls, clock };
}

test("ensureToken logs in once and reuses the token within TTL", async () => {
  const { session, calls } = setup();
  const t1 = await session.ensureToken();
  const t2 = await session.ensureToken();
  assert.equal(calls.login, 1);
  assert.equal(t1.accessToken, t2.accessToken);
});

test("getToken returns null before any ensureToken call", () => {
  const { session } = setup();
  assert.equal(session.getToken(), null);
});

test("getToken reflects the last resolved token", async () => {
  const { session } = setup();
  const t = await session.ensureToken();
  assert.equal(session.getToken()?.accessToken, t.accessToken);
});

test("refreshes the token after expiry using the buffer", async () => {
  const clock = fakeClock();
  const { session, calls } = setup({ clock });
  await session.ensureToken();
  clock.advance(3_600_000); // token TTL elapsed
  await session.ensureToken();
  assert.equal(calls.login, 1);
  assert.equal(calls.refresh, 1);
});

test("falls back to a full login when refresh fails", async () => {
  const clock = fakeClock();
  const { session, calls } = setup({ clock, refreshThrows: true });
  await session.ensureToken();
  clock.advance(3_600_000);
  await session.ensureToken();
  assert.equal(calls.login, 2);
  assert.equal(calls.refresh, 1);
});

test("concurrent ensureToken calls share a single in-flight login", async () => {
  const { session, calls } = setup();
  const [a, b] = await Promise.all([
    session.ensureToken(),
    session.ensureToken(),
  ]);
  assert.equal(calls.login, 1);
  assert.equal(a.accessToken, b.accessToken);
});

test("warns via onWarn when the token scope tenant differs from configured tenant", async () => {
  const warnings: string[] = [];
  const { session } = setup({
    loginScope: "tenant:other",
    config: { onWarn: (msg: string) => warnings.push(msg) },
  });
  await session.ensureToken();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /tenant "other".*"acme"/);
});

test("does not warn when the scope matches the configured tenant", async () => {
  const warnings: string[] = [];
  const { session } = setup({
    config: { onWarn: (msg: string) => warnings.push(msg) },
  });
  await session.ensureToken();
  assert.equal(warnings.length, 0);
});
