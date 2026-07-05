import assert from "node:assert/strict";
import { test } from "node:test";
import { createIngestClient } from "../../src/application/ingest-client.js";
import {
  AuthError,
  IngestError,
  ValidationError,
} from "../../src/domain/errors.js";
import { makeToken } from "../../src/domain/token.js";

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/**
 * Build an ingest client with in-memory fake ports and a controllable clock.
 * `overrides`: { clock, refreshThrows, ingestImpl, config }.
 */
function setup(overrides: Record<string, any> = {}) {
  const clock = overrides.clock ?? fakeClock();
  const calls: Record<string, any> = {
    login: 0,
    refresh: 0,
    resolve: 0,
    ingest: 0,
  };

  const auth = {
    async login(args: any) {
      calls.login++;
      calls.lastLogin = args;
      return makeToken({
        accessToken: `tok-${calls.login}`,
        expiresIn: 3600,
        refreshToken: "ref",
        scope: "tenant:acme",
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

  const channelDirectory = {
    async resolveHttpSecret(args: any) {
      calls.resolve++;
      calls.lastResolve = args;
      return { appSecret: `secret-${calls.resolve}`, accountId: "acc1" };
    },
  };

  const ingest = {
    async ingest(args: any) {
      calls.ingest++;
      calls.lastIngest = args;
      if (overrides.ingestImpl) {
        return overrides.ingestImpl(args, calls);
      }
      return { status: "accepted" };
    },
  };

  const config = {
    tenant: "acme",
    email: "ops@acme.com",
    password: "pw",
    tokenExpiryBufferMs: 60_000,
    ...overrides.config,
  };

  const client = createIngestClient({
    ports: { auth, channelDirectory, ingest },
    config,
    clock,
  });
  return { client, calls, clock };
}

test("first send logs in, resolves secret, and ingests once each", async () => {
  const { client, calls } = setup();
  const res = await client.sendText("hi");
  assert.equal(calls.login, 1);
  assert.equal(calls.resolve, 1);
  assert.equal(calls.ingest, 1);
  assert.equal(res.status, "accepted");
  assert.equal(res.tenant, "acme");
});

test("login carries tenant; from defaults to the login email", async () => {
  const { client, calls } = setup();
  await client.sendText("hi");
  assert.deepEqual(calls.lastLogin, {
    email: "ops@acme.com",
    password: "pw",
    tenant: "acme",
  });
  assert.equal(calls.lastIngest.tenant, "acme");
  assert.equal(calls.lastIngest.body.from, "ops@acme.com");
});

test("reuses token and secret across sends within TTL", async () => {
  const { client, calls } = setup();
  await client.sendText("one");
  await client.sendText("two");
  assert.equal(calls.login, 1);
  assert.equal(calls.resolve, 1);
  assert.equal(calls.ingest, 2);
});

test("refreshes the token after expiry", async () => {
  const clock = fakeClock();
  const { client, calls } = setup({ clock });
  await client.sendText("one");
  clock.advance(3_600_000);
  await client.sendText("two");
  assert.equal(calls.login, 1);
  assert.equal(calls.refresh, 1);
});

test("falls back to a full login when refresh fails", async () => {
  const clock = fakeClock();
  const { client, calls } = setup({ clock, refreshThrows: true });
  await client.sendText("one");
  clock.advance(3_600_000);
  await client.sendText("two");
  assert.equal(calls.login, 2);
  assert.equal(calls.refresh, 1);
});

test("validation failure touches no ports", async () => {
  const { client, calls } = setup();
  await assert.rejects(() => client.send({ from: "   " }), ValidationError);
  assert.equal(calls.login, 0);
  assert.equal(calls.resolve, 0);
  assert.equal(calls.ingest, 0);
});

test("non-accepted status surfaces as IngestError", async () => {
  const { client } = setup({
    ingestImpl: () => {
      throw new IngestError("rejected", { ingestStatus: "no_active_accounts" });
    },
  });
  await assert.rejects(
    () => client.sendText("hi"),
    (err: unknown) =>
      err instanceof IngestError && err.ingestStatus === "no_active_accounts"
  );
});

test("signature_mismatch invalidates the secret and retries once", async () => {
  let attempt = 0;
  const { client, calls } = setup({
    ingestImpl: () => {
      attempt++;
      if (attempt === 1) {
        throw new IngestError("mismatch", {
          ingestStatus: "signature_mismatch",
        });
      }
      return { status: "accepted" };
    },
  });
  const res = await client.sendText("hi");
  assert.equal(res.status, "accepted");
  assert.equal(calls.resolve, 2); // re-resolved after invalidation
  assert.equal(calls.ingest, 2);
});

test("a second signature_mismatch throws", async () => {
  const { client } = setup({
    ingestImpl: () => {
      throw new IngestError("mismatch", { ingestStatus: "signature_mismatch" });
    },
  });
  await assert.rejects(
    () => client.sendText("hi"),
    (err: unknown) =>
      err instanceof IngestError && err.ingestStatus === "signature_mismatch"
  );
});

test("explicit appSecret skips channel directory resolution", async () => {
  const { client, calls } = setup({ config: { appSecret: "preset" } });
  await client.sendText("hi");
  assert.equal(calls.resolve, 0);
  assert.equal(calls.lastIngest.appSecret, "preset");
});

test("sendText defaults from to email; explicit from overrides; send takes a rich object", async () => {
  const { client, calls } = setup();

  await client.sendText("hi");
  assert.equal(calls.lastIngest.body.from, "ops@acme.com");

  await client.sendText("hi", { from: "x@y.com" });
  assert.equal(calls.lastIngest.body.from, "x@y.com");

  await client.send({ from: "c@d.com", text: "rich", raw: { k: 1 } });
  assert.equal(calls.lastIngest.body.from, "c@d.com");
  assert.equal(calls.lastIngest.body.raw.k, 1);
});

test("sendText rejects empty text without touching ports", async () => {
  const { client, calls } = setup();
  await assert.rejects(() => client.sendText("   "), ValidationError);
  assert.equal(calls.login, 0);
});
