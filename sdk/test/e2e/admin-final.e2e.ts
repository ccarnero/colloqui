import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NotFoundError,
  PermissionError,
  RateLimitError,
} from "../../src/domain/errors.js";
import { createClient } from "../../src/index.js";

/**
 * Live-cluster regression test for the FINAL Phase 2 batch of resource
 * clients (GROWTH-PLAN.md Phase 2, priority 6): `authAdmin`, `tenants`,
 * `audit`, `jobs`, `memories`, `structuredKb`, `configFiles`, `dashboard` —
 * entirely through `createClient()`.
 *
 * Mutation scope, deliberately asymmetric per resource (see each `t.test`
 * block for the specific reasoning):
 * - `authAdmin.tenantRoles` / `authAdmin.tenantUsers`: full CRUD lifecycle.
 * - `authAdmin.publicRoutes`: create + delete with an obviously fake path,
 *   verified via `list()` (no `get(:id)` route exists at the gateway).
 * - `authAdmin.users` / `authAdmin.clients`: READ-ONLY. These are
 *   PLATFORM-wide (not tenant-scoped) resources shared by the whole dev
 *   cluster — creating throwaway platform users/API clients risks polluting
 *   shared state used by other tests/tools. Only `list()` shape is asserted.
 * - `jobs`: CRUD, created DISABLED (`is_active: false`), then briefly
 *   `enable()`d ONLY to probe `trigger()` (manual, one-shot; the schedule
 *   itself, `0 0 * * *`, cannot fire within the test window) before deletion
 *   — avoids firing real scheduled side effects or mutating scheduler state.
 *   `trigger()` asserts the gateway maps `payload` to the downstream
 *   `event_payload` field (GROWTH-PLAN.md Phase 4); confirmed live via manual
 *   curl against the dev cluster on 2026-07-05 — a job must be `is_active`
 *   for agent-admin-service to accept a trigger at all (`BadRequestException`
 *   otherwise), which is what the earlier disabled-job probe was actually
 *   hitting, not a payload-mapping regression.
 * - `audit` / `dashboard`: READ-ONLY shape assertions — inherently
 *   non-mutating GETs.
 * - `configFiles`: `templates`/`runtimeStatus`/`list` are READ-ONLY shape
 *   assertions. `upsert()`/`deploy()` (GROWTH-PLAN.md Phase 4, fixed
 *   `{name,path,content,format}` contract) are hard-asserted — the gateway
 *   fix is confirmed live on the dev cluster (2026-07-05).
 * - `structuredKb`: full lifecycle (create container -> get -> update ->
 *   query -> delete) — a leaf/logical resource, not shared infra. `query()`
 *   (GROWTH-PLAN.md Phase 4) is hard-asserted to route (no `NotFoundError`)
 *   — a fresh container has no ingested schema, so the downstream NL->SQL
 *   translation is still expected to fail, but that's a business-state
 *   error, not a routing gap.
 * - `memories`: creates a throwaway memory via `create()` (the downstream
 *   `ProposeMemoryDto` endpoint — this genuinely creates a `PROPOSED`
 *   memory, it isn't reserved for real agent-driven extraction only) and
 *   exercises `approve()`/`reject()` against two separate throwaway
 *   memories, then deletes both. `listProposals()` is also asserted
 *   read-only for shape.
 * - `tenants`: MUTATION SKIPPED ENTIRELY. `tenant-service`'s
 *   `createTenant()` provisions REAL infrastructure per tenant (Kubernetes
 *   namespaces, dedicated Mongo/Postgres hosts — see
 *   `ITenantDetail.namespaces`/`mongoHost`/`postgresHost` in
 *   `src/resources/tenants/types.ts`) — this is NOT a cheap/throwaway
 *   operation suitable for a repeatable e2e test in a shared dev cluster.
 *   Only `list()` and `get("acme")` (the pre-existing seeded tenant) are
 *   asserted.
 *
 * Gated behind SDK_E2E=1 so `npm test` stays offline-safe. Run with:
 *
 *   SDK_E2E=1 npm run test:e2e
 *
 * See test/e2e/README.md for the required environment. If localhost:8080
 * isn't reachable, restart `./port-forward.sh dev` first.
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
const PREFIX = "sdk-e2e-fin";

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

/**
 * The gateway applies a global per-tenant request-rate limit (verified live
 * 2026-07-04: unrelated to the `structuredKb` `SKBRateLimitGuard`, which only
 * guards the unimplemented `query()` route — this 429 is hit on ordinary
 * CRUD calls once enough e2e files run back-to-back against the same tenant
 * in a short window). Retries honoring the server's `Retry-After` via
 * `RateLimitError.retryAfterMs`, since the SDK's own retry policy
 * deliberately does NOT retry 429s automatically (see `src/core/retry.ts`
 * `isRetryableError` — only NETWORK/5xx are retried by design).
 */
async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastError = e;
      if (!(e instanceof RateLimitError) || i === attempts - 1) {
        throw e;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, e.retryAfterMs ?? 2000)
      );
    }
  }
  throw lastError;
}

test("SDK e2e: createClient().authAdmin / tenants / audit / jobs / memories / structuredKb / configFiles / dashboard (live cluster)", {
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
    "authAdmin.tenantRoles / tenantUsers: full create -> get -> list -> update -> delete lifecycle",
    async () => {
      const role = await client.authAdmin.tenantRoles.create({
        name: `${PREFIX}-role-${nonce}`.slice(0, 64),
        description: "sdk e2e regression role",
        permissions: [{ resource: "workflows", action: "read" }],
      });

      let tenantUserId: string | undefined;

      try {
        assert.ok(role.id);
        assert.equal(role.name, `${PREFIX}-role-${nonce}`.slice(0, 64));

        const fetchedRole = await client.authAdmin.tenantRoles.get(role.id);
        assert.equal(fetchedRole.id, role.id);
        assert.deepEqual(fetchedRole.permissions, [
          { resource: "workflows", action: "read" },
        ]);

        const roleIds: string[] = [];
        for await (const r of client.authAdmin.tenantRoles.list()) {
          roleIds.push(r.id);
        }
        assert.ok(roleIds.includes(role.id));

        const updatedRole = await client.authAdmin.tenantRoles.update(role.id, {
          description: "sdk e2e regression role (updated)",
        });
        assert.equal(
          updatedRole.description,
          "sdk e2e regression role (updated)"
        );

        const tenantUser = await client.authAdmin.tenantUsers.create({
          email: `${PREFIX}-user-${nonce}@example.com`,
          password: "sdk-e2e-password-1",
          role_id: role.id,
          display_name: `${PREFIX} user ${nonce}`,
        });
        tenantUserId = tenantUser.id;
        assert.equal(tenantUser.email, `${PREFIX}-user-${nonce}@example.com`);

        const fetchedUser = await client.authAdmin.tenantUsers.get(
          tenantUser.id
        );
        assert.equal(fetchedUser.id, tenantUser.id);

        const userIds: string[] = [];
        for await (const u of client.authAdmin.tenantUsers.list()) {
          userIds.push(u.id);
        }
        assert.ok(userIds.includes(tenantUser.id));

        const updatedUser = await client.authAdmin.tenantUsers.update(
          tenantUser.id,
          { display_name: `${PREFIX} user ${nonce} (updated)` }
        );
        assert.equal(
          updatedUser.display_name,
          `${PREFIX} user ${nonce} (updated)`
        );
      } finally {
        if (tenantUserId) {
          await client.authAdmin.tenantUsers
            .remove(tenantUserId)
            .catch(() => undefined);
        }
        await client.authAdmin.tenantRoles.remove(role.id);

        const rolesAfterDelete: string[] = [];
        for await (const r of client.authAdmin.tenantRoles.list()) {
          rolesAfterDelete.push(r.id);
        }
        assert.ok(!rolesAfterDelete.includes(role.id));
      }
    }
  );

  await t.test(
    "authAdmin.publicRoutes: create -> verify via list -> delete -> verify removal via list",
    async (t2) => {
      // `POST/GET/DELETE auth/public-routes` requires `@Scopes("platform")`
      // at the gateway. The e2e login user may only hold a tenant-scoped
      // token in some environments — assert the platform-only behavior when
      // available, otherwise document the skip rather than fail the run.
      let route: Awaited<
        ReturnType<typeof client.authAdmin.publicRoutes.create>
      >;
      try {
        const fakePath = `/${PREFIX}-fake-route-${nonce}`;
        route = await withRateLimitRetry(() =>
          client.authAdmin.publicRoutes.create({
            method: "GET",
            path_pattern: fakePath,
            scope: "platform",
          })
        );
      } catch (e: unknown) {
        if (e instanceof PermissionError) {
          t2.diagnostic(
            `authAdmin.publicRoutes requires platform scope, not available to ${EMAIL} in this environment: ${e.message}`
          );
          return;
        }
        throw e;
      }

      try {
        assert.ok(route.id);

        const idsAfterCreate: string[] = [];
        for await (const r of client.authAdmin.publicRoutes.list()) {
          idsAfterCreate.push(r.id);
        }
        assert.ok(idsAfterCreate.includes(route.id));
      } finally {
        await client.authAdmin.publicRoutes.remove(route.id);

        const idsAfterDelete: string[] = [];
        for await (const r of client.authAdmin.publicRoutes.list()) {
          idsAfterDelete.push(r.id);
        }
        assert.ok(
          !idsAfterDelete.includes(route.id),
          "publicRoutes.remove() actually deleted the route, not just returned 200"
        );
      }
    }
  );

  await t.test(
    "authAdmin.users / clients: read-only (platform-wide, shared cluster state)",
    async (t2) => {
      // Same platform-scope caveat as publicRoutes above.
      try {
        const userIds: string[] = [];
        for await (const u of client.authAdmin.users.list()) {
          userIds.push(u.id);
        }
        assert.ok(Array.isArray(userIds));

        const clientIds: string[] = [];
        for await (const c of client.authAdmin.clients.list()) {
          clientIds.push(c.id);
        }
        assert.ok(Array.isArray(clientIds));
      } catch (e: unknown) {
        if (e instanceof PermissionError) {
          t2.diagnostic(
            `authAdmin.users/clients requires platform scope, not available to ${EMAIL} in this environment: ${e.message}`
          );
          return;
        }
        throw e;
      }
    }
  );

  await t.test(
    "tenants: read-only against the pre-existing 'acme' tenant (mutation skipped, see file header)",
    async () => {
      const names: string[] = [];
      for await (const tenant of client.tenants.list()) {
        names.push(tenant.name);
      }
      assert.ok(names.includes("acme"));

      const acme = await client.tenants.get("acme");
      assert.equal(acme.name, "acme");
      assert.ok(acme.id);
    }
  );

  await t.test(
    "audit: read-only shape assertions for events and channel-events",
    async () => {
      const eventsPage = await client.audit.events.list({ limit: 5 }).page();
      assert.ok(Array.isArray(eventsPage.items));
      if (eventsPage.items.length > 0) {
        const [first] = eventsPage.items;
        assert.equal(typeof first!.id, "string");
        assert.equal(typeof first!.type, "string");

        const fetched = await client.audit.events.get(first!.id);
        assert.equal(fetched.id, first!.id);
      }

      const channelEventsPage = await client.audit.channelEvents
        .list({ limit: 5 })
        .page();
      assert.ok(Array.isArray(channelEventsPage.items));
    }
  );

  await t.test("dashboard: read-only shape assertions", async () => {
    const stats = await client.dashboard.getStats();
    assert.equal(typeof stats.requestsToday, "number");
    assert.equal(typeof stats.uptime, "number");
    assert.ok(stats.quotaApiCalls);
    assert.equal(typeof stats.quotaApiCalls.limit, "number");
    assert.ok(stats.serviceHealth);
  });

  await t.test(
    "configFiles: read-only shape assertions for templates and runtime/status",
    async () => {
      const templates = await withRateLimitRetry(() =>
        client.configFiles.templates()
      );
      assert.ok(Array.isArray(templates));

      const status = await withRateLimitRetry(() =>
        client.configFiles.runtimeStatus()
      );
      assert.equal(typeof status.configured, "boolean");
      assert.ok(Array.isArray(status.connected_runtimes));

      const filesPage = await withRateLimitRetry(() =>
        client.configFiles.list({ limit: 5 }).page()
      );
      assert.ok(Array.isArray(filesPage.items));
    }
  );

  await t.test(
    "configFiles: upsert() + deploy() — FIXED {name,path,content,format} " +
      "contract (GROWTH-PLAN.md Phase 4), confirmed live on the dev cluster 2026-07-05",
    async () => {
      const path = `sdk-e2e/${PREFIX}-${nonce}.yaml`;
      const upserted = await withRateLimitRetry(() =>
        client.configFiles.upsert({
          name: `${PREFIX}-cfg-${nonce}`,
          path,
          content: "key: value",
          format: "yaml",
        })
      );
      assert.equal(upserted.path, path);
      assert.equal(upserted.format, "yaml");

      const deployed = await withRateLimitRetry(() =>
        client.configFiles.deploy({ deletePaths: [path] })
      );
      assert.ok(Array.isArray(deployed.files));
    }
  );

  await t.test(
    "jobs: create (disabled) -> get -> list -> enable -> trigger (payload maps to event_payload) -> delete",
    async () => {
      const agent = await withRateLimitRetry(() =>
        client.agents.create({
          name: `${PREFIX}-agent-${nonce}`,
          system_prompt: "You are a helpful SDK e2e test assistant.",
        })
      );

      let jobId: string | undefined;

      try {
        const job = await withRateLimitRetry(() =>
          client.jobs.create({
            name: `${PREFIX}-job-${nonce}`,
            agent_id: agent.id,
            schedule: "0 0 * * *",
            is_active: false,
          })
        );
        jobId = job.id;

        assert.equal(job.name, `${PREFIX}-job-${nonce}`);
        assert.equal(job.is_active, false);

        const fetched = await withRateLimitRetry(() => client.jobs.get(job.id));
        assert.equal(fetched.id, job.id);

        const jobIds: string[] = [];
        for await (const j of client.jobs.list({ agent_id: agent.id })) {
          jobIds.push(j.id);
        }
        assert.ok(jobIds.includes(job.id));

        // agent-admin-service's JobsService.trigger() rejects any job whose
        // `is_active` is false with a 400 `BadRequestException` before it
        // ever looks at the payload — enable first so this probes the
        // GROWTH-PLAN.md Phase 4 `payload` -> `event_payload` field mapping,
        // not the (unrelated, working-as-intended) active-job guard.
        await withRateLimitRetry(() => client.jobs.enable(job.id));

        const execution = await withRateLimitRetry(() =>
          client.jobs.trigger(job.id, { payload: { probe: true } })
        );
        assert.equal(execution.job_id, job.id);
        assert.deepEqual(execution.event_payload, { probe: true });
      } finally {
        if (jobId) {
          await client.jobs.remove(jobId).catch(() => undefined);
        }
        await client.agents.remove(agent.id).catch(() => undefined);
      }
    }
  );

  await t.test(
    "memories: create throwaway proposal -> approve; create second -> reject; listProposals read-only; delete both",
    async () => {
      const toApprove = await withRateLimitRetry(() =>
        client.memories.create({
          scope: "TENANT",
          kind: "NOTICE",
          title: `${PREFIX}-memory-approve-${nonce}`,
          content: "sdk e2e regression memory (approve path)",
        })
      );
      const toReject = await withRateLimitRetry(() =>
        client.memories.create({
          scope: "TENANT",
          kind: "NOTICE",
          title: `${PREFIX}-memory-reject-${nonce}`,
          content: "sdk e2e regression memory (reject path)",
        })
      );

      try {
        assert.equal(toApprove.status, "PROPOSED");
        assert.equal(toReject.status, "PROPOSED");

        const proposalIds: string[] = [];
        for await (const m of client.memories.listProposals({ limit: 50 })) {
          proposalIds.push(m.id);
        }
        assert.ok(proposalIds.includes(toApprove.id));
        assert.ok(proposalIds.includes(toReject.id));

        const approved = await withRateLimitRetry(() =>
          client.memories.approve(toApprove.id)
        );
        assert.notEqual(approved.status, "PROPOSED");

        const rejected = await withRateLimitRetry(() =>
          client.memories.reject(toReject.id)
        );
        assert.equal(rejected.status, "REJECTED");
      } finally {
        await client.memories.remove(toApprove.id).catch(() => undefined);
        await client.memories.remove(toReject.id).catch(() => undefined);
      }
    }
  );

  await t.test(
    "structuredKb: create container -> get -> list -> update -> query -> delete",
    async () => {
      const container = await withRateLimitRetry(() =>
        client.structuredKb.containers.create({
          name: `${PREFIX}-skb-${nonce}`,
          description: "sdk e2e regression container",
        })
      );

      try {
        assert.equal(container.name, `${PREFIX}-skb-${nonce}`);
        assert.ok(container.id);

        const fetched = await withRateLimitRetry(() =>
          client.structuredKb.containers.get(container.id)
        );
        assert.equal(fetched.id, container.id);

        const ids: string[] = [];
        for await (const c of client.structuredKb.containers.list()) {
          ids.push(c.id);
        }
        assert.ok(ids.includes(container.id));

        const updated = await withRateLimitRetry(() =>
          client.structuredKb.containers.update(container.id, {
            description: "sdk e2e regression container (updated)",
          })
        );
        assert.equal(
          updated.description,
          "sdk e2e regression container (updated)"
        );

        // FIXED (GROWTH-PLAN.md Phase 4): `query()`'s gateway route is
        // confirmed live 2026-07-05 (no more 404 — routed through to
        // `structured-kb-service`). A fresh container has no schema
        // ingested, so the downstream NL->SQL translation itself is
        // expected to fail (500) — that failure is a genuine business-state
        // error, not a routing gap, so assert it is NOT a `NotFoundError`
        // (proving the route resolves) rather than tolerating any outcome.
        await assert.rejects(
          () =>
            client.structuredKb.containers.query(container.id, {
              query: "sdk e2e probe query",
            }),
          (e: unknown) => {
            assert.ok(
              !(e instanceof NotFoundError),
              "query() route must not 404 — GROWTH-PLAN.md Phase 4 fix is live"
            );
            return true;
          }
        );
      } finally {
        await client.structuredKb.containers.remove(container.id);
      }
    }
  );
});
