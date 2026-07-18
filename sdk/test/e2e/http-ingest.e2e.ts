import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../../src/index.js";

/**
 * Live-cluster regression test. Reproduces the flow of
 * `scripts/e2e/http-workflow.sh` (login -> fresh http channel account ->
 * webhook ingest -> "accepted") but drives the ingest step through the SDK's
 * public API (`createClient` -> `send` / `sendText`) instead of raw curl.
 *
 * Account CRUD is not part of the SDK yet (see sdk/GROWTH-PLAN.md Phase 2), so
 * this test uses plain `fetch` for setup/teardown of the http channel account
 * and only exercises the SDK for the `send` / `sendText` primitives under test.
 *
 * Gated behind SDK_E2E=1 so `npm test` stays offline-safe. Run with:
 *
 *   SDK_E2E=1 npm run test:e2e
 *
 * See test/e2e/README.md for the required environment and how to reach the
 * dev cluster (port-forward vs ingress hostname).
 */

const RUN_E2E = process.env.SDK_E2E === "1";

// --- env resolution -------------------------------------------------------
// Mirrors integrations/lib/resolve-env.sh: prefer an explicit YOIZEN_BASE_URL,
// else probe a local port-forward (`./port-forward.sh dev`, default port
// 8080), else fall back to the ingress hostname the SDK itself defaults to.
const YWAI_ENV = process.env.YWAI_ENV ?? "dev";
const DEV_DOMAIN =
  process.env.DEV_DOMAIN ?? process.env.MINIKUBE_DOMAIN ?? "dev.local";
const API_GATEWAY_PORT = process.env.API_GATEWAY_PORT ?? "8080";
const GW_HOST = `api-gateway.platform-services-${YWAI_ENV}.${DEV_DOMAIN}`;

const TENANT = process.env.YOIZEN_TENANT ?? "acme";
const EMAIL = process.env.YOIZEN_EMAIL ?? "yclawd@demo.io";
const PASSWORD = process.env.YOIZEN_PASSWORD ?? "admin123";
const ACCOUNT_PREFIX = "sdk-e2e-http";

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
  // Return the port-forward URL anyway; the caller will get a clear network
  // error from the SDK/raw fetch rather than a silent skip.
  return localhost;
}

// --- raw-fetch admin helpers (account CRUD; not in SDK scope yet) --------

interface RawAccount {
  id: string;
  externalId: string;
  appSecret: string;
}

async function login(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-yoizen-tenant": TENANT,
    },
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      tenant_id: TENANT,
    }),
  });
  const body = (await res.json()) as { access_token?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(
      `setup login failed: ${res.status} ${JSON.stringify(body)}`
    );
  }
  return body.access_token;
}

async function listHttpAccounts(
  baseUrl: string,
  token: string
): Promise<RawAccount[]> {
  const res = await fetch(`${baseUrl}/api/channels/accounts?channel=http`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-yoizen-tenant": TENANT,
    },
  });
  if (!res.ok) {
    return [];
  }
  return (await res.json()) as RawAccount[];
}

async function deleteAccount(
  baseUrl: string,
  token: string,
  id: string
): Promise<void> {
  await fetch(`${baseUrl}/api/channels/accounts/${id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-yoizen-tenant": TENANT,
    },
  }).catch(() => undefined);
}

async function createAccount(
  baseUrl: string,
  token: string,
  externalId: string
): Promise<RawAccount> {
  const res = await fetch(`${baseUrl}/api/channels/accounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-yoizen-tenant": TENANT,
    },
    body: JSON.stringify({
      channel: "http",
      provider: "http",
      name: "SDK E2E HTTP Ingest",
      externalId,
      accessToken: "placeholder",
    }),
  });
  const body = (await res.json()) as Partial<RawAccount> & {
    appSecret?: string;
  };
  if (!res.ok || !body.appSecret || !body.id) {
    throw new Error(
      `setup account creation failed: ${res.status} ${JSON.stringify(body)}`
    );
  }
  return { id: body.id, externalId, appSecret: body.appSecret };
}

test("SDK e2e: createClient -> send/sendText -> http webhook accepted (live cluster)", {
  skip:
    !RUN_E2E &&
    "set SDK_E2E=1 to run against a live dev cluster (see test/e2e/README.md)",
}, async (t) => {
  const baseUrl = await resolveBaseUrl();
  t.diagnostic(`baseUrl=${baseUrl} tenant=${TENANT} email=${EMAIL}`);

  const adminToken = await login(baseUrl);

  // Best-effort hygiene: remove accounts left over from previous runs.
  const stale = await listHttpAccounts(baseUrl, adminToken);
  for (const acc of stale) {
    if (acc.externalId?.startsWith(ACCOUNT_PREFIX)) {
      await deleteAccount(baseUrl, adminToken, acc.id);
    }
  }

  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const externalId = `${ACCOUNT_PREFIX}-${nonce}`;
  const account = await createAccount(baseUrl, adminToken, externalId);

  try {
    const client = createClient({
      tenant: TENANT,
      email: EMAIL,
      password: PASSWORD,
      baseUrl,
      channelSelector: { externalId: account.externalId },
    });

    // Note: the webhook ingest endpoint currently only echoes back
    // `{ status: "accepted" }` — accountId/messageId are NOT populated by the
    // platform today, even though SendResult declares them (optional) for
    // when the platform does return them. Assert the documented optional
    // shape rather than requiring presence.
    const assertOptionalStringShape = (value: unknown) => {
      assert.ok(
        value === undefined || (typeof value === "string" && value.length > 0),
        `expected undefined or non-empty string, got ${JSON.stringify(value)}`
      );
    };

    await t.test("send() is accepted", async () => {
      const result = await client.send({
        from: "sdk-e2e-user",
        text: `sdk-e2e-send-${nonce}`,
      });
      assert.equal(result.status, "accepted");
      assert.equal(result.tenant, TENANT);
      assertOptionalStringShape(result.accountId);
      assertOptionalStringShape(result.messageId);
    });

    await t.test("sendText() is accepted", async () => {
      const result = await client.sendText(`sdk-e2e-sendText-${nonce}`);
      assert.equal(result.status, "accepted");
      assert.equal(result.tenant, TENANT);
      assertOptionalStringShape(result.accountId);
      assertOptionalStringShape(result.messageId);
    });
  } finally {
    await deleteAccount(baseUrl, adminToken, account.id);
  }
});
