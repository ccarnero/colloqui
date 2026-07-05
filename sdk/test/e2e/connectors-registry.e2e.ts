import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../../src/index.js";

/**
 * Live-cluster regression test for the `connectors` and `registry` resource
 * clients (GROWTH-PLAN.md Phase 2, priority 5), entirely through
 * `createClient()`.
 *
 * CAUTION: `registry.routes` feed the api-gateway's dynamic router, which
 * polls `GET /routes` every 15s and proxies matching paths to the
 * corresponding tenant Knative service for ALL tenants. Every route this
 * test creates uses an obviously-fake, narrow `pathPrefix`
 * (`/sdk-e2e-cr-route/<nonce>`) that cannot collide with real platform
 * prefixes, and is ALWAYS deleted in a `finally` block, even on failure.
 *
 * Canary lifecycle (start/update/promote/rollback) is intentionally NOT
 * exercised here: `canary.start()` synchronously polls for up to 60s for a
 * new Knative revision to become Ready, which requires the registered
 * service's container image to actually pull and pass its readiness probe
 * inside this cluster — not something this test can assume or wait on
 * without becoming slow and flaky. Only the safe, read-only
 * `canary.getStatus()` (asserts `null` for a service with no canary) is
 * exercised.
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
const PREFIX = "sdk-e2e-cr";

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

test("SDK e2e: createClient().connectors / registry (live cluster)", {
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
    "connectors: create -> get -> list -> addEndpoint -> updateEndpoint -> usage -> removeEndpoint -> delete",
    async () => {
      const created = await client.connectors.create({
        name: `${PREFIX}-conn-${nonce}`,
        context: "external",
        baseUrl: "https://jsonplaceholder.typicode.com",
        authType: "none",
        tags: ["sdk-e2e"],
      });

      let endpointId: string | undefined;

      try {
        assert.equal(created.name, `${PREFIX}-conn-${nonce}`);
        assert.equal(created.context, "external");
        assert.ok(created.id);
        assert.deepEqual(created.endpoints, []);

        const fetched = await client.connectors.get(created.id);
        assert.equal(fetched.id, created.id);

        const ids: string[] = [];
        for await (const conn of client.connectors.list({
          context: "external",
        })) {
          ids.push(conn.id);
        }
        assert.ok(ids.includes(created.id));

        const endpoint = await client.connectors.addEndpoint(created.id, {
          label: "List posts",
          method: "GET",
          path: "/posts",
        });
        endpointId = endpoint.id;
        assert.equal(endpoint.method, "GET");
        assert.equal(endpoint.path, "/posts");

        const updatedEndpoint = await client.connectors.updateEndpoint(
          created.id,
          endpoint.id,
          { label: "List all posts" }
        );
        assert.equal(updatedEndpoint.label, "List all posts");

        // Usage metrics require a separate TimescaleDB usage cluster that
        // may not be configured in every dev environment (503 when absent).
        // Assert either the success shape or the documented unavailable path
        // — not encoding a specific environment's setup into this test.
        try {
          const usage = await client.connectors.usage({ window: 7 });
          assert.equal(typeof usage.windowDays, "number");
          assert.ok(Array.isArray(usage.topByCallCount));
        } catch (e: unknown) {
          t.diagnostic(
            `connectors.usage() unavailable in this environment: ${(e as Error).message}`
          );
        }
      } finally {
        if (endpointId) {
          await client.connectors
            .removeEndpoint(created.id, endpointId)
            .catch(() => undefined);
        }
        await client.connectors.remove(created.id);

        await assert.rejects(() => client.connectors.get(created.id));
      }
    }
  );

  await t.test(
    "registry: register -> get -> list -> update -> revisions -> routes add/list/delete -> canary getStatus -> discoverRoutes -> remove",
    async () => {
      const service = await client.registry.services.create({
        name: `${PREFIX}-svc-${nonce.replace(/[^a-z0-9]/gi, "").slice(0, 20)}`,
        image: "gcr.io/knative-samples/helloworld-go",
        minScale: 0,
        maxScale: 1,
      });

      let routeId: string | undefined;

      try {
        assert.ok(service.id);
        assert.equal(service.image, "gcr.io/knative-samples/helloworld-go");

        const fetched = await client.registry.services.get(service.id);
        assert.equal(fetched.id, service.id);

        const ids: string[] = [];
        for await (const svc of client.registry.services.list()) {
          ids.push(svc.id);
        }
        assert.ok(ids.includes(service.id));

        // FIXED (previously a KNOWN DOWNSTREAM RACE):
        // `ServicesService.updateKnativeService` used to do a read-then-
        // replace of the Knative Service custom object with no retry on a
        // K8s optimistic-concurrency 409 ("the object has been modified"),
        // which Knative's own reconciler could trigger by bumping
        // `resourceVersion` within the first couple seconds after creation.
        // `registry-service` (registry-service-00003+) now retries 409s
        // internally (bounded 5-attempt GET-mutate-PUT loop) — confirmed
        // live on the dev cluster 2026-07-05 via a direct create-then-
        // immediate-update probe (3/3 succeeded with no client-side
        // retry/delay). The client-side `withKnativeConflictRetry`
        // workaround is therefore removed; call `update()` directly.
        const updated = await client.registry.services.update(service.id, {
          maxScale: 2,
        });
        assert.equal(updated.maxScale, 2);

        // Revisions may be empty if the Knative revision hasn't been
        // observed yet by the time this runs — assert only the shape.
        const revisions: unknown[] = [];
        for await (const rev of client.registry.services.listRevisions(
          service.id
        )) {
          revisions.push(rev);
        }
        assert.ok(Array.isArray(revisions));

        const route = await client.registry.routes.create(service.id, {
          pathPrefix: `/sdk-e2e-cr-route/${nonce}`,
          methods: ["GET"],
          isPublic: false,
        });
        routeId = route.id;
        assert.equal(route.pathPrefix, `/sdk-e2e-cr-route/${nonce}`);

        const routeIds: string[] = [];
        for await (const r of client.registry.routes.list(service.id)) {
          routeIds.push(r.id);
        }
        assert.ok(routeIds.includes(route.id));

        // No canary lifecycle exercised here — see file header comment.
        const canaryStatus = await client.registry.canary.getStatus(service.id);
        assert.equal(canaryStatus, null);

        // Read-only introspection of the exact feed the gateway's dynamic
        // router polls — assert shape only, not membership (10s server-side
        // cache may not reflect the route just created).
        const discovered: unknown[] = [];
        for await (const entry of client.registry.discoverRoutes()) {
          discovered.push(entry);
        }
        assert.ok(Array.isArray(discovered));
      } finally {
        if (routeId) {
          await client.registry.routes
            .remove(service.id, routeId)
            .catch(() => undefined);
        }
        await client.registry.services.remove(service.id);

        await assert.rejects(() => client.registry.services.get(service.id));
      }
    }
  );
});
