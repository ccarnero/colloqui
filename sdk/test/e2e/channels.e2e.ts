import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../../src/index.js";

/**
 * Live-cluster regression test for the `channels` + `webhooks` resource
 * clients (GROWTH-PLAN.md Phase 2). Exercises an http-channel account
 * lifecycle (create -> get -> list -> patch -> refresh-token rejection for
 * non-meta providers -> delete -> verify gone) plus a webhook ingest through
 * the created account, entirely through `createClient()`. Streams/usage are
 * asserted only for correct shape (may be empty on a fresh dev cluster).
 *
 * Gated behind SDK_E2E=1 so `npm test` stays offline-safe. Run with:
 *
 *   SDK_E2E=1 npm run test:e2e
 *
 * See test/e2e/README.md for the required environment.
 */

const RUN_E2E = process.env.SDK_E2E === "1";

const YWAI_ENV = process.env.YWAI_ENV ?? "dev";
const DEV_DOMAIN =
  process.env.DEV_DOMAIN ?? process.env.MINIKUBE_DOMAIN ?? "dev.local";
const API_GATEWAY_PORT = process.env.API_GATEWAY_PORT ?? "8080";
const GW_HOST = `api-gateway.platform-services-${YWAI_ENV}.${DEV_DOMAIN}`;

const TENANT = process.env.YOIZEN_TENANT ?? "acme";
const EMAIL = process.env.YOIZEN_EMAIL ?? "yclawd@demo.io";
const PASSWORD = process.env.YOIZEN_PASSWORD ?? "admin123";
const ACCOUNT_PREFIX = "sdk-e2e-ch";

async function reachable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveBaseUrl(): Promise<string> {
  if (process.env.YOIZEN_BASE_URL) {
    return process.env.YOIZEN_BASE_URL;
  }
  const localhost = `http://localhost:${API_GATEWAY_PORT}`;
  if (await reachable(localhost)) {
    return localhost;
  }
  const ingress = `http://${GW_HOST}`;
  if (await reachable(ingress)) {
    return ingress;
  }
  return localhost;
}

test("SDK e2e: createClient().channels -> account CRUD + webhooks.ingest() (live cluster)", {
  skip:
    !RUN_E2E &&
    "set SDK_E2E=1 to run against a live dev cluster (see test/e2e/README.md)",
}, async (t) => {
  const baseUrl = await resolveBaseUrl();
  t.diagnostic(`baseUrl=${baseUrl} tenant=${TENANT} email=${EMAIL}`);

  const client = createClient({
    tenant: TENANT,
    email: EMAIL,
    password: PASSWORD,
    baseUrl,
  });

  // Best-effort hygiene: remove accounts left over from previous failed runs.
  for await (const acc of client.channels.listAccounts({ channel: "http" })) {
    if (acc.externalId.startsWith(ACCOUNT_PREFIX)) {
      await client.channels.removeAccount(acc.id).catch(() => undefined);
    }
  }

  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const externalId = `${ACCOUNT_PREFIX}-${nonce}`;

  const created = await client.channels.createAccount({
    channel: "http",
    provider: "http",
    name: `SDK e2e channels ${nonce}`,
    externalId,
    accessToken: "placeholder",
  });

  try {
    await t.test("createAccount() returns the persisted account", () => {
      assert.equal(created.channel, "http");
      assert.equal(created.externalId, externalId);
      assert.equal(created.tenantId, TENANT);
      assert.ok(created.id);
      assert.ok(created.appSecret, "http accounts get a generated appSecret");
    });

    await t.test("getAccount() returns the same account", async () => {
      const fetched = await client.channels.getAccount(created.id);
      assert.equal(fetched.id, created.id);
      assert.equal(fetched.externalId, externalId);
    });

    await t.test("listAccounts() contains the created account", async () => {
      const ids: string[] = [];
      for await (const acc of client.channels.listAccounts({
        channel: "http",
      })) {
        ids.push(acc.id);
      }
      assert.ok(ids.includes(created.id));
    });

    await t.test("updateAccount() patches the name", async () => {
      const updated = await client.channels.updateAccount(created.id, {
        name: `SDK e2e channels ${nonce} renamed`,
      });
      assert.equal(updated.name, `SDK e2e channels ${nonce} renamed`);
    });

    await t.test(
      "refreshAccountToken() rejects a non-meta provider with 400",
      async () => {
        await assert.rejects(() =>
          client.channels.refreshAccountToken(created.id)
        );
      }
    );

    await t.test(
      "webhooks.ingest() accepts a message through the created account",
      async () => {
        const result = await client.webhooks.ingest({
          tenant: TENANT,
          channel: "http",
          instance: externalId,
          body: { from: "sdk-e2e-user", text: `sdk-e2e-webhook-${nonce}` },
          headers: { "x-http-channel-token": created.appSecret! },
        });
        assert.equal(result.status, "accepted");
      }
    );

    await t.test("listStreams() returns a well-shaped list", async () => {
      const page = await client.channels.listStreams().page();
      assert.ok(Array.isArray(page.items));
      for (const stream of page.items) {
        assert.equal(typeof stream.name, "string");
        assert.ok(stream.kind === "ingress" || stream.kind === "dlq");
      }
    });

    await t.test("listUsage() returns a well-shaped list", async () => {
      const now = new Date();
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const to = now.toISOString();
      const page = await client.channels
        .listUsage({ from, to, bucket: "hour" })
        .page();
      assert.ok(Array.isArray(page.items));
    });

    await t.test("listUsageTotals() returns a well-shaped list", async () => {
      const now = new Date();
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const to = now.toISOString();
      const page = await client.channels.listUsageTotals({ from, to }).page();
      assert.ok(Array.isArray(page.items));
    });

    await t.test(
      "usageSummary() returns the 24h aggregate (channel-service SQL fix deployed)",
      async () => {
        const summary = await client.channels.usageSummary();
        assert.equal(summary.windowHours, 24);
        assert.ok(Array.isArray(summary.byChannel));
        assert.ok(typeof summary.total.ingress === "number");
      }
    );
  } finally {
    await client.channels.removeAccount(created.id);

    await t.test("getAccount() 404s after deletion", async () => {
      await assert.rejects(() => client.channels.getAccount(created.id));
    });
  }
});
