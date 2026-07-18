import assert from "node:assert/strict";
import { test } from "node:test";
import { NotFoundError } from "../../src/domain/errors.js";
import { createClient } from "../../src/index.js";

/**
 * Live-cluster regression test for the `workflows` resource client
 * (GROWTH-PLAN.md Phase 2). Exercises create -> get -> list -> execute ->
 * poll execution -> listExecutions -> delete -> verify deletion, entirely
 * through `createClient().workflows`.
 *
 * The workflow definition is a minimal single-`jsFunction`-action definition
 * — the same activity `scripts/e2e/http-workflow.sh` Stage 3 uses — but
 * WITHOUT a `message_received` trigger: that script's trigger only matters
 * for channel-triggered auto-invocation (an http webhook post), which is out
 * of scope here. `POST /workflows/:id/execute` invokes a definition directly
 * regardless of any trigger, so this test needs no channel account.
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
const WORKFLOW_NAME_PREFIX = "sdk-e2e-workflow";
const POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_500;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("SDK e2e: createClient().workflows -> create/get/list/execute/executions/delete (live cluster)", {
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

  // Best-effort hygiene: remove workflows left over from previous failed runs.
  for await (const wf of client.workflows.list()) {
    if (wf.name.startsWith(WORKFLOW_NAME_PREFIX)) {
      await client.workflows.remove(wf.id).catch(() => undefined);
    }
  }

  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const workflowName = `${WORKFLOW_NAME_PREFIX}-${nonce}`;

  const created = await client.workflows.create({
    name: workflowName,
    application: "sdk-e2e",
    actions: [
      {
        name: "echo",
        activity: "jsFunction",
        args: {
          code: "(ctx) => { return ctx.request.text; }",
        },
      },
    ],
  });

  try {
    await t.test("create() returns the persisted workflow", () => {
      assert.equal(created.name, workflowName);
      assert.equal(created.application, "sdk-e2e");
      assert.equal(created.tenantId, TENANT);
      assert.ok(created.id);
    });

    await t.test("get() returns the same workflow", async () => {
      const fetched = await client.workflows.get(created.id);
      assert.equal(fetched.id, created.id);
      assert.equal(fetched.name, workflowName);
    });

    await t.test("list() contains the created workflow", async () => {
      const ids: string[] = [];
      for await (const wf of client.workflows.list()) {
        ids.push(wf.id);
      }
      assert.ok(ids.includes(created.id));
    });

    // `t.test()` reports pass/fail, not the callback's return value, so the
    // execute() result is captured directly and only asserted inside t.test.
    const execResult = await client.workflows.execute(created.id, {
      request: { text: nonce },
    });

    await t.test("execute() starts a run", () => {
      assert.equal(execResult.definitionId, created.id);
      assert.ok(execResult.executionId);
    });

    await t.test("getExecution() eventually reports COMPLETED", async () => {
      const executionId = execResult.executionId;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let status = "";
      while (Date.now() < deadline) {
        const execStatus = await client.workflows.getExecution(
          created.id,
          executionId
        );
        status = execStatus.status;
        if (status === "COMPLETED" || status === "FAILED") {
          break;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      assert.equal(status, "COMPLETED");
    });

    await t.test("listExecutions() contains the execution", async () => {
      const ids: string[] = [];
      for await (const ex of client.workflows.listExecutions(created.id)) {
        ids.push(ex.id);
      }
      assert.ok(ids.includes(execResult.executionId));
    });

    // Confirmed LIVE on the dev cluster as of 2026-07-05 (GROWTH-PLAN.md
    // Phase 4) — asserted directly, no skip-guard needed.
    await t.test(
      "summary() returns the tenant-wide aggregate stats",
      async () => {
        const summary = await client.workflows.summary();
        assert.ok(summary.activeDefinitions >= 0);
        assert.ok(Array.isArray(summary.topByExecutionCountLast7d));
      }
    );
  } finally {
    await client.workflows.remove(created.id);

    await t.test("get() 404s after deletion", async () => {
      await assert.rejects(
        () => client.workflows.get(created.id),
        NotFoundError
      );
    });
  }
});
