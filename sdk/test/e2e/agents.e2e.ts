import assert from "node:assert/strict";
import { test } from "node:test";
import { NotFoundError } from "../../src/domain/errors.js";
import { createClient } from "../../src/index.js";

/**
 * Live-cluster regression test for the `agents` resource client
 * (GROWTH-PLAN.md Phase 2). Exercises create -> get -> list -> update ->
 * publish -> delete -> verify deletion, entirely through
 * `createClient().agents`.
 *
 * The agent payload mirrors the minimal shape used by
 * `integrations/ai/ai-agent-playground/setup.sh` and
 * `integrations/ai/ai-agent-triage/setup.sh` (`agent_payload()`): `name`,
 * `system_prompt`, `model_config.llm` (provider/model/connectorId/
 * temperature), empty `tools`/`channels`. `provider: "env"` with no
 * `connectorId` avoids needing a working LLM connector for create/get/list/
 * update/publish/delete — none of those call the LLM (only a real runtime
 * execution does, see runtime.e2e.ts).
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
const AGENT_NAME_PREFIX = "sdk-e2e-agent";

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

test("SDK e2e: createClient().agents -> create/get/list/update/publish/delete (live cluster)", {
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

  // Best-effort hygiene: remove agents left over from previous failed runs.
  for await (const agent of client.agents.list()) {
    if (agent.name.startsWith(AGENT_NAME_PREFIX)) {
      await client.agents.remove(agent.id).catch(() => undefined);
    }
  }

  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const agentName = `${AGENT_NAME_PREFIX}-${nonce}`;

  const created = await client.agents.create({
    name: agentName,
    system_prompt: "You are a concise SDK e2e test agent.",
    model_config: {
      llm: {
        provider: "env",
        model: "gpt-4o-mini",
        temperature: 0.2,
      },
    },
    tools: [],
    channels: [],
  });

  try {
    await t.test("create() returns the persisted agent", () => {
      assert.equal(created.name, agentName);
      assert.equal(created.status, "draft");
      assert.ok(created.id);
    });

    await t.test("get() returns the same agent", async () => {
      const fetched = await client.agents.get(created.id);
      assert.equal(fetched.id, created.id);
      assert.equal(fetched.name, agentName);
    });

    await t.test("list() contains the created agent", async () => {
      const ids: string[] = [];
      for await (const agent of client.agents.list()) {
        ids.push(agent.id);
      }
      assert.ok(ids.includes(created.id));
    });

    const updated = await client.agents.update(created.id, {
      description: "updated by sdk e2e",
    });

    await t.test("update() persists the new description", () => {
      assert.equal(updated.description, "updated by sdk e2e");
    });

    const published = await client.agents.publish(created.id);

    await t.test("publish() marks the agent as published", () => {
      assert.equal(published.status, "published");
      assert.ok(published.published_at);
    });

    await t.test(
      "listVersions() reports at least one version after publish",
      async () => {
        const versions = await client.agents.listVersions(created.id);
        assert.ok(versions.length >= 1);
      }
    );

    await t.test(
      "listMemoryProposals() / revert() — FIXED gateway routes added for " +
        "GROWTH-PLAN.md Phase 4 (agents revert + memory-proposals), " +
        "confirmed live on the dev cluster 2026-07-05",
      async () => {
        const result = await client.agents.listMemoryProposals();
        assert.ok(Array.isArray(result.proposals));

        // update() after publish() left a draft/published divergence;
        // revert() discards it back to the published config.
        const reverted = await client.agents.revert(created.id);
        assert.equal(reverted.id, created.id);
      }
    );
  } finally {
    await client.agents.remove(created.id);

    await t.test("get() 404s after deletion", async () => {
      await assert.rejects(() => client.agents.get(created.id), NotFoundError);
    });
  }
});
