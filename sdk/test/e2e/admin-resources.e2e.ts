import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../../src/index.js";

/**
 * Live-cluster regression test for the `knowledgeBases`, `skills`,
 * `systemVariables`, and `mcpServers` resource clients (GROWTH-PLAN.md Phase
 * 2, priority 4). Exercises a full create/get/list/update/delete lifecycle
 * per resource, plus a document upload + reingest flow for `knowledgeBases`,
 * entirely through `createClient()`.
 *
 * `skills`/`systemVariables`/`knowledgeBases` soft-delete and return `null`
 * (HTTP 200) instead of a 404 for a missing/deleted id — see the gap notes
 * in each resource's `types.ts`. `mcpServers` has normal REST semantics
 * (`get()`/`delete()` genuinely 404 on a missing id).
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
const PREFIX = "sdk-e2e-adm";

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

test("SDK e2e: createClient().skills / systemVariables / mcpServers / knowledgeBases (live cluster)", {
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

  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  await t.test(
    "skills: create -> get -> list -> update -> delete",
    async () => {
      const created = await client.skills.create({
        name: `${PREFIX}-skill-${nonce}`,
        system_prompt: "You are a helpful SDK e2e test assistant.",
      });

      try {
        assert.equal(created.name, `${PREFIX}-skill-${nonce}`);
        assert.ok(created.id);

        const fetched = await client.skills.get(created.id);
        assert.ok(fetched);
        assert.equal(fetched!.id, created.id);

        const ids: string[] = [];
        for await (const skill of client.skills.list()) {
          ids.push(skill.id);
        }
        assert.ok(ids.includes(created.id));

        // FIXED (GROWTH-PLAN.md Phase 4, `agent-admin-service`'s
        // `postgres.js` fragment-join bug in `SkillsService.update`) —
        // confirmed live on the dev cluster 2026-07-05: 200 with the
        // persisted update, no more 500 on every payload.
        const updated = await client.skills.update(created.id, {
          when_to_use: "sdk e2e regression",
        });
        assert.ok(updated);
        assert.equal(updated!.when_to_use, "sdk e2e regression");
      } finally {
        const removed = await client.skills.remove(created.id);
        assert.equal(removed, true);

        const afterDelete = await client.skills.get(created.id);
        assert.equal(
          afterDelete,
          null,
          "get() returns null for a soft-deleted skill"
        );
      }
    }
  );

  await t.test(
    "systemVariables: create -> get -> list -> update -> delete",
    async () => {
      const created = await client.systemVariables.create({
        name: `${PREFIX}_var_${nonce.replace(/[-.]/g, "_")}`,
        type: "string",
        value: "hello",
      });

      try {
        // FIXED (GROWTH-PLAN.md Phase 4, `agent-admin-service`'s
        // `SystemVariablesService.create` double-JSON-encoding via
        // `::jsonb` cast) — confirmed live on the dev cluster 2026-07-05:
        // `value` round-trips as the bare string, matching `update()`'s
        // (already-correct) behavior.
        assert.equal(created.value, "hello");
        assert.ok(created.id);

        const fetched = await client.systemVariables.get(created.id);
        assert.ok(fetched);
        assert.equal(fetched!.id, created.id);

        const ids: string[] = [];
        for await (const v of client.systemVariables.list()) {
          ids.push(v.id);
        }
        assert.ok(ids.includes(created.id));

        const updated = await client.systemVariables.update(created.id, {
          value: "updated",
        });
        assert.ok(updated);
        // Unlike create() (double-encoded, see above), update() takes a
        // different code path (`sql.unsafe` raw-SQL-embedded value, not a
        // bound parameter — see types.ts) that happens to round-trip
        // correctly. Asserting the CURRENT behavior for both, however
        // inconsistent, not "fixing" it client-side.
        assert.equal(updated!.value, "updated");
      } finally {
        const removed = await client.systemVariables.remove(created.id);
        assert.equal(removed, true);

        const afterDelete = await client.systemVariables.get(created.id);
        assert.equal(
          afterDelete,
          null,
          "get() returns null for a soft-deleted system variable"
        );
      }
    }
  );

  await t.test(
    "mcpServers: create -> get -> list -> update -> delete (real 404 semantics)",
    async () => {
      const created = await client.mcpServers.create({
        name: `${PREFIX}-mcp-${nonce}`,
        transport_type: "http",
        url: "https://example.com/sdk-e2e-mcp",
      });

      try {
        assert.equal(created.name, `${PREFIX}-mcp-${nonce}`);
        assert.ok(created.id);

        const fetched = await client.mcpServers.get(created.id);
        assert.equal(fetched.id, created.id);

        const ids: string[] = [];
        for await (const server of client.mcpServers.list()) {
          ids.push(server.id);
        }
        assert.ok(ids.includes(created.id));

        const updated = await client.mcpServers.update(created.id, {
          enabled: false,
        });
        assert.equal(updated.enabled, false);
      } finally {
        await client.mcpServers.remove(created.id);

        await assert.rejects(
          () => client.mcpServers.get(created.id),
          "get() 404s for a deleted MCP server"
        );
      }
    }
  );

  await t.test(
    "knowledgeBases: create -> get -> list -> patch -> upload document -> reingest -> delete",
    async () => {
      const created = await client.knowledgeBases.create({
        name: `${PREFIX}-kb-${nonce}`,
      });

      let documentId: string | undefined;

      try {
        assert.equal(created.name, `${PREFIX}-kb-${nonce}`);
        assert.ok(created.id);

        const fetched = await client.knowledgeBases.get(created.id);
        assert.ok(fetched);
        assert.equal(fetched!.id, created.id);

        const ids: string[] = [];
        for await (const kb of client.knowledgeBases.list()) {
          ids.push(kb.id);
        }
        assert.ok(ids.includes(created.id));

        const patched = await client.knowledgeBases.update(created.id, {
          description: "sdk e2e regression",
        });
        assert.ok(patched);
        assert.equal(patched!.description, "sdk e2e regression");

        const uploadResult = await client.knowledgeBases.documents.upload(
          created.id,
          {
            content_text: "SDK e2e knowledge base document content.",
            original_filename: `${PREFIX}-doc-${nonce}.txt`,
            mime_type: "text/plain",
            content_type: "text",
          }
        );
        documentId = uploadResult.documentId;
        assert.ok(documentId);
        assert.equal(uploadResult.status, "pending");

        const docsSeen: string[] = [];
        for await (const doc of client.knowledgeBases.documents.list(
          created.id
        )) {
          docsSeen.push(doc.id);
        }
        assert.ok(docsSeen.includes(documentId));

        // Reingestion runs asynchronously (NATS-published); assert only
        // the accepted/status response shape, not completion.
        const reingestResult = await client.knowledgeBases.documents.reingest(
          created.id,
          documentId
        );
        assert.equal(reingestResult.documentId, documentId);
        assert.equal(reingestResult.status, "pending");
      } finally {
        if (documentId) {
          await client.knowledgeBases.documents
            .remove(created.id, documentId)
            .catch(() => undefined);
        }

        const removed = await client.knowledgeBases.remove(created.id);
        assert.equal(removed, true);

        const afterDelete = await client.knowledgeBases.get(created.id);
        assert.equal(
          afterDelete,
          null,
          "get() returns null for a soft-deleted knowledge base"
        );
      }
    }
  );
});
