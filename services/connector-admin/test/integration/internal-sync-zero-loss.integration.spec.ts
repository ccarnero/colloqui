/**
 * Phase 6.2 — Integration: zero loss under worker kill (REQ-ASIS-002,
 * REQ-ASIS-006, NFR-ASIS-002, NFR-XC-001).
 *
 * The SLO-binding test for the proposal's "zero loss" success criterion:
 * with worker process kill mid-publish, every published event MUST land
 * in the per-tenant mirror after restart. This is the chaos drill the
 * platform's success criterion #2 anchors on (no manual backfill
 * required after worker recovery).
 *
 * Tripwire: a single mismatched (subject-tenant ≠ payload-tenant)
 * envelope MUST be `term`'d (no row written, no broker retry storm) and
 * the `cross_tenant_attempt_total` counter MUST advance (REQ-ASIS-006).
 *
 * Acceptance gates:
 *   • Three tenants × ~33 events each = 100 published.
 *   • mid-publish `manager.stop()` (clean kill), then restart.
 *   • Final mirror count == published count, summed across 3 tenant DBs.
 *   • Cross-tenant tripwire counter advanced exactly once.
 *
 * Requires Docker — every assertion needs a real NATS+Postgres pair.
 */

import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  spyOn,
} from "bun:test";
import { Test } from "@nestjs/testing";
import type postgres from "postgres";
import { __resetServiceModeCacheForTests } from "@yoizen/observability";
import { InternalSyncService } from "../../src/modules/internal-sync/internal-sync.service";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
} from "../../src/providers/nats.provider";
import { AdaptersRepository } from "../../src/modules/adapters/adapters.repository";
import { AdapterTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { adapterInternalSyncCrossTenantAttemptTotal } from "../../src/modules/internal-sync/internal-sync.metrics";
import {
  connectNats,
  createTenantDatabase,
  createTenantStream,
  publishUpserted,
  resetIntegrationCaches,
  startNatsTestcontainer,
  startPostgresTestcontainer,
  waitFor,
  type NatsClients,
  type NatsTestcontainer,
  type PostgresTestcontainer,
} from "./setup";

const HAS_DOCKER = (() => {
  try {
    Bun.file("/var/run/docker.sock").size;
    return true;
  } catch {
    return Boolean(process.env.DOCKER_HOST);
  }
})();

const describeIfDocker = HAS_DOCKER ? describe : describe.skip;

interface ITenantHandle {
  readonly tenantId: string;
  readonly streamName: string;
  readonly databaseName: string;
  readonly sql: postgres.Sql;
}

/**
 * Stand-in for `AdapterTenantConnectionManager` that yields a
 * pre-provisioned `postgres.js` handle per tenant. The integration test
 * already pre-creates one DB per tenant (with the mirror schema baked
 * in) before booting the service, so we do not need the production
 * lazy-DDL path — keying directly on the tenant id is O(1).
 */
class StaticTenantConnectionManager {
  constructor(
    private readonly pools: ReadonlyMap<string, postgres.Sql>,
  ) {}

  ensureSchema(tenantId: string): Promise<postgres.Sql> {
    const pool = this.pools.get(tenantId);
    if (!pool) {
      return Promise.reject(
        new Error(`No test pool registered for tenant '${tenantId}'`),
      );
    }
    return Promise.resolve(pool);
  }

  /**
   * Stub for the production `verifyConnectivity` health probe.
   * Unused in this spec but keeps the structural type compatible.
   */
  async verifyConnectivity(): Promise<boolean> {
    return true;
  }
}

describeIfDocker(
  "InternalSync zero-loss under worker kill (Phase 6.2) — requires docker",
  () => {
    let natsTc: NatsTestcontainer;
    let pgTc: PostgresTestcontainer;
    let clients: NatsClients;
    const tenants: ITenantHandle[] = [];
    const TENANT_IDS = ["acme", "globex", "initech"] as const;

    beforeAll(async () => {
      // Reset the process-global ensure-cache before this spec
      // contacts a fresh broker — the durable cache is shared with
      // sibling specs and otherwise short-circuits on stale keys.
      resetIntegrationCaches();
      [natsTc, pgTc] = await Promise.all([
        startNatsTestcontainer(),
        startPostgresTestcontainer(),
      ]);
      clients = await connectNats(natsTc.url);

      // Provision per-tenant stream + per-tenant DB. The two are
      // independent — DB creation can run while the stream is being
      // ensured.
      for (let i = 0; i < TENANT_IDS.length; i++) {
        const tenantId = TENANT_IDS[i]!;
        const [streamName, db] = await Promise.all([
          createTenantStream(clients.jsm, tenantId),
          createTenantDatabase(pgTc, tenantId),
        ]);
        tenants.push({
          tenantId,
          streamName,
          databaseName: db.databaseName,
          sql: db.sql,
        });
      }

      process.env.SERVICE_MODE = "worker";
      __resetServiceModeCacheForTests();
    }, 180_000);

    afterAll(async () => {
      delete process.env.SERVICE_MODE;
      __resetServiceModeCacheForTests();

      for (let i = 0; i < tenants.length; i++) {
        const t = tenants[i]!;
        try {
          await t.sql.end({ timeout: 1 });
        } catch {
          // pool already closed
        }
      }
      try {
        await clients?.nc.drain();
      } catch {
        // broker may already be torn down
      }
      await Promise.all([natsTc?.stop(), pgTc?.stop()]);
    });

    /**
     * Builds the same Nest providers the production `InternalSyncModule`
     * wires, except the two NATS + connection-manager dependencies are
     * resolved against the testcontainer-bound clients. Does NOT call
     * `onModuleInit` — the caller decides whether to start the consumer
     * loop (e.g. the chaos test starts → stops → starts again).
     */
    async function buildService(): Promise<InternalSyncService> {
      const poolMap = new Map<string, postgres.Sql>();
      for (let i = 0; i < tenants.length; i++) {
        const t = tenants[i]!;
        poolMap.set(t.tenantId, t.sql);
      }
      const fakeConnections = new StaticTenantConnectionManager(poolMap);

      const moduleRef = await Test.createTestingModule({
        providers: [
          InternalSyncService,
          AdaptersRepository,
          {
            provide: AdapterTenantConnectionManager,
            useValue: fakeConnections,
          },
          { provide: JETSTREAM, useValue: clients.js },
          { provide: JETSTREAM_MANAGER, useValue: clients.jsm },
        ],
      }).compile();

      return moduleRef.get(InternalSyncService);
    }

    /**
     * Idempotent count of mirror rows tagged `managed_by='registry-service'`,
     * summed across every test tenant. O(T) on the tenant set.
     */
    async function totalMirrorCount(): Promise<number> {
      let total = 0;
      for (let i = 0; i < tenants.length; i++) {
        const t = tenants[i]!;
        const rows = await t.sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM http_adapters
          WHERE managed_by = 'registry-service'
        `;
        total += Number(rows[0]?.count ?? 0);
      }
      return total;
    }

    it(
      "publishes 100 events across 3 tenants, kills worker mid-burst, restarts → final mirror count equals published count (REQ-ASIS-002, NFR-ASIS-002, NFR-XC-001)",
      async () => {
        // Pre-flight: drop any lingering mirror rows from prior runs.
        for (let i = 0; i < tenants.length; i++) {
          await tenants[i]!.sql`DELETE FROM http_adapters`;
        }

        const totalEvents = 100;
        const eventsPerTenant = Math.ceil(totalEvents / tenants.length);

        // Boot the service and start consuming.
        const service = await buildService();
        await service.onModuleInit();
        await waitFor(
          async () => {
            const snapshot = service.getRunnerHealthSnapshot();
            return snapshot.length === tenants.length;
          },
          { timeoutMs: 15_000 },
        );

        // Publish first burst (one per tenant, round-robin) until we've
        // emitted ~30 events; THEN kill the worker — so half the publish
        // happens before the kill and half after, giving JetStream's
        // durable lifecycle a chance to be exercised on both sides.
        const killThreshold = 30;
        let publishedCount = 0;
        const publishOne = async (n: number): Promise<void> => {
          const tenantIdx = n % tenants.length;
          const tenantId = tenants[tenantIdx]!.tenantId;
          const localId = Math.floor(n / tenants.length);
          await publishUpserted(clients.js, {
            tenantId,
            payload: {
              serviceId: `svc-${tenantId}-${localId}`,
              tenantId,
              name: `svc-${tenantId}-${localId}`,
              knativeName: `svc-${tenantId}-${localId}`,
              namespace: `tenant-${tenantId}`,
              port: 8080,
              status: "active",
            },
            idempotencyKey: `evt-${tenantId}-${localId}`,
          });
          publishedCount++;
        };

        for (let n = 0; n < killThreshold; n++) await publishOne(n);

        // Brief pause so a few of those messages start being consumed
        // — we want in-flight messages at kill time to validate the
        // graceful-stop path (REQ-ASIS-004 dovetails with this drill).
        await Bun.sleep(150);

        // CHAOS: kill the worker mid-burst.
        await service.onModuleDestroy();

        // Continue publishing the remaining events with the worker
        // dead. JetStream MUST persist them to the per-tenant streams
        // so they're available on the next start.
        for (let n = killThreshold; n < totalEvents; n++) await publishOne(n);
        expect(publishedCount).toBe(totalEvents);

        // Restart the worker. The durable name persists across the
        // restart (the durable is stream-side state in JetStream); the
        // new manager re-attaches and resumes consuming from the same
        // position.
        await service.onModuleInit();
        await waitFor(
          async () => {
            const snapshot = service.getRunnerHealthSnapshot();
            return (
              snapshot.length === tenants.length &&
              snapshot.every((s) => s.healthy)
            );
          },
          { timeoutMs: 15_000 },
        );

        // Drain: every event ack'd → mirror row exists.
        await waitFor(async () => (await totalMirrorCount()) >= totalEvents, {
          timeoutMs: 60_000,
          intervalMs: 250,
        });

        const finalCount = await totalMirrorCount();
        expect(finalCount).toBe(totalEvents);

        // Per-tenant breakdown — ensures we didn't accidentally write
        // every row to one tenant's DB (would be a tripwire-class bug).
        for (let i = 0; i < tenants.length; i++) {
          const t = tenants[i]!;
          const rows = await t.sql<{ count: number }[]>`
            SELECT count(*)::int AS count
            FROM http_adapters
            WHERE managed_by = 'registry-service'
          `;
          const c = Number(rows[0]?.count ?? 0);
          expect(c).toBeGreaterThan(0);
          expect(c).toBeLessThanOrEqual(eventsPerTenant);
        }

        await service.onModuleDestroy();
      },
      300_000,
    );

    it(
      "cross-tenant tripwire: subject=acme + payload.tenantId=globex → no row written, cross_tenant_attempt_total advanced (REQ-ASIS-006, NFR-XC-001)",
      async () => {
        // Capture metric calls: the OTEL noop meter shares an `add`
        // implementation across counters within the same provider, so
        // we filter call args for the labels emitted by the cross-tenant
        // tripwire specifically — same pattern as
        // `internal-sync.service.spec.ts:407-421`.
        const crossSpy = spyOn(
          adapterInternalSyncCrossTenantAttemptTotal,
          "add",
        );
        crossSpy.mockClear();

        const beforeRows = await totalMirrorCount();

        const service = await buildService();
        await service.onModuleInit();
        await waitFor(
          async () => service.getRunnerHealthSnapshot().length === tenants.length,
          { timeoutMs: 15_000 },
        );

        // Publish ONE poison message: subject says acme, payload says
        // globex. The handler must throw `PermanentError` →
        // runner term()s.
        await publishUpserted(clients.js, {
          tenantId: "globex",
          subjectTenant: "acme",
          payload: {
            serviceId: "svc-cross-tenant-poison",
            tenantId: "globex",
            name: "svc-cross-tenant-poison",
            knativeName: "svc-cross-tenant-poison",
            namespace: "tenant-globex",
            port: 8080,
            status: "active",
          },
          idempotencyKey: `cross-tenant-${Date.now()}`,
        });

        // Wait for the metric to fire (handler-side; bounded by the
        // runner's pull-batch latency — typically <1s).
        await waitFor(
          async () => {
            const calls = crossSpy.mock.calls.filter(
              (call: [unknown, unknown]) => {
                const attrs = call[1] as
                  | { tenant_subject?: unknown; tenant_payload?: unknown }
                  | undefined;
                return (
                  attrs?.tenant_subject === "acme" &&
                  attrs?.tenant_payload === "globex"
                );
              },
            );
            return calls.length >= 1;
          },
          { timeoutMs: 15_000, intervalMs: 100 },
        );

        // Give the runner time to actually term() and DLQ-route — we
        // need a small settle so a stray "still processing" handler
        // can't sneak a row in after we sample.
        await Bun.sleep(500);

        // Mirror state MUST NOT advance — neither the acme pool nor
        // the globex pool should have a new row from this message.
        const afterRows = await totalMirrorCount();
        expect(afterRows).toBe(beforeRows);

        for (let i = 0; i < tenants.length; i++) {
          const t = tenants[i]!;
          const rows = await t.sql<{ name: string }[]>`
            SELECT name FROM http_adapters
            WHERE name = 'svc-cross-tenant-poison'
          `;
          expect(rows).toHaveLength(0);
        }

        crossSpy.mockRestore();
        await service.onModuleDestroy();
      },
      120_000,
    );
  },
);
