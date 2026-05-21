/**
 * Phase 6.4 — E2E: cold-start of `connector-admin-worker` ≤90s p95
 * (REQ-ASA-003, NFR-ASA-001, NFR-ASIS-003, NFR-XC-002).
 *
 * Goal:
 *   With KEDA `idleReplicaCount: 0` for the worker Deployment, a single
 *   `POST /registry/services` MUST drive the worker 0→1 within
 *   `pollingInterval (30s) + cooldown (120s)` and the corresponding
 *   `http_adapters` mirror row MUST land in the tenant DB within
 *   p95 ≤90s of the registry HTTP commit.
 *
 * Harness reality:
 *   The shared E2E harness (`tests/e2e/helpers.ts`) speaks ONLY to the
 *   `api-gateway` over Kourier. It has NO kubectl, NO Prometheus
 *   client, and NO direct tenant Postgres handle. Because of this:
 *
 *     • The full SLO assertion (KEDA-toggled `Active=True` AND mirror
 *       row materialised in <90s) requires three privileged surfaces
 *       this harness does not own. We gate it behind the env flag
 *       `E2E_KEDA_HARNESS=1` — a CI/operator opts in by also
 *       providing `KUBECTL_CONTEXT`, `PROMETHEUS_URL`, and per-tenant
 *       SQL handles via `E2E_ADAPTER_TENANT_DB_URL_<TENANT>` env.
 *
 *     • Without the flag the spec runs in "soft" mode: it exercises
 *       the registry CRUD path — i.e. that `POST /registry/services`
 *       remains 201/200 with both `REGISTRY_EMIT_ADAPTER_SYNC=true`
 *       AND `=false`. This is the *only* SLO-adjacent guarantee the
 *       gateway-only harness can give without lying about KEDA.
 *
 *     • The hard SLO drill is documented by Phase-7 gate **7.5** in
 *       `.sdd/changes/adapter-internal-sync-durable/tasks.md` and
 *       expected to run manually on staging during the soak window.
 *       The runbook is reproduced inline below so an operator can
 *       run it without round-tripping back to the proposal.
 *
 * Deferral rationale:
 *   Wiring kubectl/Prometheus into the bun e2e harness would (a)
 *   require shipping a `kubectl` binary inside the test image, (b)
 *   add ServiceAccount RBAC for ScaledObject reads, and (c) require
 *   a direct path from the test pod to the per-tenant CNPG poolers.
 *   Each of those changes is bigger than the test itself — see
 *   `design.md` "Testing Strategy" for the explicit deferral note.
 *
 * Manual runbook (Phase 7.5):
 *   1. `kubectl scale deployment connector-admin-worker --replicas=0`
 *      (or just wait for KEDA to reap the pod after 120s idle).
 *   2. Confirm `kubectl get scaledobject connector-admin-worker-scaler`
 *      shows `Active: false`.
 *   3. `t0 = $(date +%s)`; `POST /api/registry/services` with a fresh
 *      service payload and an authenticated tenant.
 *   4. Watch `kubectl get scaledobject … -w`: the trigger should fire
 *      within `pollingInterval` (30s) once Prometheus reports
 *      `num_pending > 0`. Worker pod should be `Ready` shortly after.
 *   5. Connect to the tenant pool (e.g.
 *      `psql $TENANT_PG_URL -c "select * from http_adapters where managed_by='registry-service' order by updated_at desc limit 5;"`).
 *      Mirror row MUST be present within p95 ≤90s of `t0`.
 *   6. Repeat 5× for a p95 estimate (NFR-ASA-001 / NFR-XC-002).
 *   7. Flip `REGISTRY_EMIT_ADAPTER_SYNC=false` (rollout step 5 in
 *      `design.md`) and assert: next `POST /registry/services`
 *      produces NO new `Nats-Msg-Id` on the tenant ingress stream
 *      (`nats stream ls INGRESS-<tenant>` last_seq unchanged) AND
 *      no new mirror row appears.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { getBaseUrl, httpDelete, httpGet, httpPost, poll } from "./helpers";
import { authHeaders } from "./auth.setup";

const GW = getBaseUrl("api-gateway");

/**
 * Hard SLO ceilings extracted directly from the proposal (NFR-ASA-001
 * + NFR-XC-002). Kept as constants so the runbook below references
 * exactly the numbers the test enforces — operator and test stay in
 * lockstep without a doc drift.
 */
const COLD_START_P95_MS = 90_000;
const KEDA_TRIGGER_BUDGET_MS = 30_000 + 120_000; // pollingInterval + cooldown
const REGISTRY_REQUEST_BUDGET_MS = 60_000;

/**
 * Hardened opt-in: the KEDA assertions only fire when the operator
 * explicitly says the test environment provides:
 *   • KEDA `ScaledObject` for `connector-admin-worker-scaler`
 *   • Prometheus reachable from the test pod
 *   • A per-tenant Postgres handle URL (or a service that exposes one)
 *
 * Otherwise we degrade to a soft test that ONLY validates the
 * registry HTTP contract — never touching the SLO numbers. Anything
 * stronger would silently pass on machines that lack the harness and
 * become a tripwire-class regression hide.
 */
const KEDA_HARNESS_ENABLED = process.env.E2E_KEDA_HARNESS === "1";

/**
 * Service payload factory. Uses `Date.now()` + monotonic counter so
 * back-to-back `it()` cases never collide on the registry's
 * `(tenantId, name)` unique index.
 */
let serviceCounter = 0;
function buildServicePayload(): {
  name: string;
  image: string;
  port: number;
  minScale: number;
  maxScale: number;
} {
  serviceCounter++;
  return {
    name: `e2e-cold-start-${Date.now().toString(36)}-${serviceCounter}`,
    image: "gcr.io/knative-samples/helloworld-go:latest",
    port: 8080,
    minScale: 0,
    maxScale: 1,
  };
}

interface RegistryService {
  id: string;
  name: string;
}

const createdServiceIds: string[] = [];

afterAll(async () => {
  if (createdServiceIds.length === 0) return;
  const h = await authHeaders();
  for (let i = 0; i < createdServiceIds.length; i++) {
    const id = createdServiceIds[i]!;
    try {
      await httpDelete(`${GW}/registry/services/${id}`, { headers: h });
    } catch {
      // best-effort cleanup; the test tenant is also wiped by
      // `scripts/cleanup-tenant.ts` after the run
    }
  }
});

async function registerService(): Promise<RegistryService> {
  const headers = await authHeaders();
  const start = Date.now();
  const { status, body } = await httpPost<RegistryService>(
    `${GW}/registry/services`,
    buildServicePayload(),
    { headers, timeoutMs: REGISTRY_REQUEST_BUDGET_MS },
  );
  const elapsed = Date.now() - start;
  expect(status).toBe(201);
  expect(elapsed).toBeLessThan(REGISTRY_REQUEST_BUDGET_MS);
  expect(body.id).toBeDefined();
  createdServiceIds.push(body.id);
  return body;
}

/**
 * Confirms the registered service is observable via the gateway's
 * registry GET. This does NOT prove a mirror row landed in the
 * adapter-service tenant DB — that requires direct SQL access — but
 * it guarantees the registry write actually committed (REQ-RSE-003)
 * which is the precondition for the publish event-emission. The
 * publish itself is post-commit and best-effort per spec.
 */
async function expectServiceVisible(id: string): Promise<void> {
  const headers = await authHeaders();
  const result = await poll(
    async () => {
      const res = await httpGet<{ id: string }>(
        `${GW}/registry/services/${id}`,
        { headers },
      );
      if (res.status === 200 && res.body.id === id) return res.body;
      return null;
    },
    { timeoutMs: 30_000, initialDelayMs: 250, maxDelayMs: 2_000 },
  );
  expect(result.id).toBe(id);
}

// ═══════════════════════════════════════════════════════════════════
//  Soft E2E (always runs) — registry HTTP contract is the only thing
//  the gateway-only harness can prove without lying about KEDA.
// ═══════════════════════════════════════════════════════════════════

describe("E2E: connector-admin-worker cold-start (Phase 6.4)", () => {
  it(
    "POST /registry/services succeeds within budget — minimum gate behind the SLO drill (REQ-ASA-003)",
    async () => {
      const svc = await registerService();
      await expectServiceVisible(svc.id);
    },
    180_000,
  );

  // KEDA-bound SLO assertion. Only flipped on by an operator that has
  // opted-in to the privileged harness. See the file-level comment
  // for the gating rationale and the manual runbook.
  if (!KEDA_HARNESS_ENABLED) {
    it.skip(
      `[deferred to gate 7.5] KEDA scales worker 0→1 within ${KEDA_TRIGGER_BUDGET_MS}ms and mirror row appears in p95 ≤${COLD_START_P95_MS}ms (NFR-ASA-001, NFR-XC-002)`,
      () => {
        // Documented in the file header. Runner hooks (kubectl,
        // Prometheus, tenant SQL) live in `tests/e2e/helpers.ts`
        // and are intentionally NOT wired here — they would require
        // RBAC + image changes outside the scope of Phase 6.
      },
    );

    it.skip(
      `[deferred to gate 7.5] REGISTRY_EMIT_ADAPTER_SYNC=false → no broker activity, no new mirror row (REQ-RSE-004)`,
      () => {
        // Manual: flip the flag in the registry-service Deployment
        // env and rerun the same POST. Assert
        //   nats consumer info INGRESS-<tenant> adapter-internal-sync
        // shows last_delivered_seq unchanged AND
        //   select count(*) from http_adapters where managed_by='registry-service'
        // is unchanged after a 60s settle.
      },
    );
  } else {
    // Live gate. The operator-supplied harness MUST expose three
    // helpers in `helpers.ts`:
    //   • `kubectlGetScaledObject(name) → { active: boolean }`
    //   • `prometheusInstantQuery(promql) → number`
    //   • `tenantSqlOneShot(tenantId, sql) → unknown[]`
    // Until those exist, the assertion below is gated — flipping
    // E2E_KEDA_HARNESS=1 without the helpers wired surfaces a clear
    // ReferenceError so the operator knows what to wire next.
    it(
      `KEDA scales worker 0→1 and mirror row lands in p95 ≤${COLD_START_P95_MS}ms (NFR-ASA-001, NFR-XC-002)`,
      async () => {
        type KubectlGetScaledObject = (
          name: string,
        ) => Promise<{ active: boolean }>;
        type PrometheusInstantQuery = (q: string) => Promise<number>;
        type TenantSqlOneShot = (
          tenant: string,
          sql: string,
        ) => Promise<unknown[]>;
        const helpers = (await import("./helpers")) as unknown as {
          kubectlGetScaledObject?: KubectlGetScaledObject;
          prometheusInstantQuery?: PrometheusInstantQuery;
          tenantSqlOneShot?: TenantSqlOneShot;
        };
        if (
          !helpers.kubectlGetScaledObject ||
          !helpers.prometheusInstantQuery ||
          !helpers.tenantSqlOneShot
        ) {
          throw new Error(
            "E2E_KEDA_HARNESS=1 but tests/e2e/helpers.ts is missing " +
              "{kubectlGetScaledObject, prometheusInstantQuery, " +
              "tenantSqlOneShot}. Wire these in before enabling.",
          );
        }

        // 1. Pre-condition: ScaledObject inactive (worker at 0).
        const before = await helpers.kubectlGetScaledObject(
          "connector-admin-worker-scaler",
        );
        expect(before.active).toBe(false);

        // 2. Drive the publish.
        const t0 = Date.now();
        const svc = await registerService();

        // 3. ScaledObject toggles active within KEDA budget.
        await poll(
          async () => {
            const so = await helpers.kubectlGetScaledObject!(
              "connector-admin-worker-scaler",
            );
            return so.active ? so : null;
          },
          { timeoutMs: KEDA_TRIGGER_BUDGET_MS, initialDelayMs: 1_000 },
        );

        // 4. Prometheus pending count drains to 0 (consumer caught up).
        await poll(
          async () => {
            const pending = await helpers.prometheusInstantQuery!(
              "sum(jetstream_consumer_num_pending{consumer_name=\"adapter-internal-sync\"})",
            );
            return pending === 0 ? true : null;
          },
          { timeoutMs: COLD_START_P95_MS, initialDelayMs: 500 },
        );

        // 5. Mirror row materialised within p95 budget.
        const tenant =
          process.env.E2E_TENANT ?? `acme-${Date.now().toString(12)}`;
        const rows = await helpers.tenantSqlOneShot(
          tenant,
          `SELECT name FROM http_adapters WHERE managed_by = 'registry-service' AND name = '${svc.name}'`,
        );
        expect(rows.length).toBeGreaterThanOrEqual(1);

        const elapsed = Date.now() - t0;
        expect(elapsed).toBeLessThan(COLD_START_P95_MS);
      },
      COLD_START_P95_MS + KEDA_TRIGGER_BUDGET_MS + 30_000,
    );
  }
});
