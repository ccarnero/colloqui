/**
 * Phase 6.2 — Integration: zero loss under worker kill (REQ-ASIS-002,
 * REQ-ASIS-006, NFR-ASIS-002, NFR-XC-001).
 *
 * Requires Docker — every assertion needs a real NATS+Mongo pair.
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
import type { Db, MongoClient } from "mongodb";
import { __resetServiceModeCacheForTests } from "@yoizen/observability";
import { InternalSyncService } from "../../src/modules/internal-sync/internal-sync.service";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
} from "../../src/providers/nats.provider";
import { AdaptersMongoRepository } from "../../src/modules/adapters/adapters.mongo.repository";
import { ADAPTERS_REPOSITORY } from "../../src/modules/adapters/adapters.repository.interface";
import { AdapterTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { adapterInternalSyncCrossTenantAttemptTotal } from "../../src/modules/internal-sync/internal-sync.metrics";
import {
  connectNats,
  createTenantMongoDatabase,
  createTenantStream,
  publishUpserted,
  resetIntegrationCaches,
  startMongoTestcontainer,
  startNatsTestcontainer,
  waitFor,
  type MongoTestcontainer,
  type NatsClients,
  type NatsTestcontainer,
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
  readonly db: Db;
  readonly client: MongoClient;
}

class StaticTenantMongoConnectionManager {
  constructor(private readonly dbs: ReadonlyMap<string, Db>) {}

  ensureSchema(tenantId: string): Promise<Db> {
    const db = this.dbs.get(tenantId);
    if (!db) {
      return Promise.reject(
        new Error(`No test database registered for tenant '${tenantId}'`),
      );
    }
    return Promise.resolve(db);
  }

  async verifyConnectivity(): Promise<boolean> {
    return true;
  }
}

describeIfDocker(
  "InternalSync zero-loss under worker kill (Phase 6.2) — requires docker",
  () => {
    let natsTc: NatsTestcontainer;
    let mongoTc: MongoTestcontainer;
    let clients: NatsClients;
    const tenants: ITenantHandle[] = [];
    const TENANT_IDS = ["acme", "globex", "initech"] as const;

    beforeAll(async () => {
      resetIntegrationCaches();
      [natsTc, mongoTc] = await Promise.all([
        startNatsTestcontainer(),
        startMongoTestcontainer(),
      ]);
      clients = await connectNats(natsTc.url);

      for (let i = 0; i < TENANT_IDS.length; i++) {
        const tenantId = TENANT_IDS[i]!;
        const [streamName, tenantDb] = await Promise.all([
          createTenantStream(clients.jsm, tenantId),
          createTenantMongoDatabase(mongoTc, tenantId),
        ]);
        tenants.push({
          tenantId,
          streamName,
          databaseName: tenantDb.databaseName,
          db: tenantDb.db,
          client: tenantDb.client,
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
          await t.client.close();
        } catch {
          // already closed
        }
      }
      try {
        await clients?.nc.drain();
      } catch {
        // broker may already be torn down
      }
      await Promise.all([natsTc?.stop(), mongoTc?.stop()]);
    });

    async function buildService(): Promise<InternalSyncService> {
      const dbMap = new Map<string, Db>();
      for (let i = 0; i < tenants.length; i++) {
        const t = tenants[i]!;
        dbMap.set(t.tenantId, t.db);
      }
      const fakeConnections = new StaticTenantMongoConnectionManager(dbMap);

      const moduleRef = await Test.createTestingModule({
        providers: [
          InternalSyncService,
          AdaptersMongoRepository,
          {
            provide: ADAPTERS_REPOSITORY,
            useExisting: AdaptersMongoRepository,
          },
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

    async function totalMirrorCount(): Promise<number> {
      let total = 0;
      for (let i = 0; i < tenants.length; i++) {
        const t = tenants[i]!;
        total += await t.db
          .collection("http_adapters")
          .countDocuments({ managed_by: "registry-service" });
      }
      return total;
    }

    it(
      "publishes 100 events across 3 tenants, kills worker mid-burst, restarts → final mirror count equals published count (REQ-ASIS-002, NFR-ASIS-002, NFR-XC-001)",
      async () => {
        for (let i = 0; i < tenants.length; i++) {
          await tenants[i]!.db.collection("http_adapters").deleteMany({});
        }

        const totalEvents = 100;
        const eventsPerTenant = Math.ceil(totalEvents / tenants.length);

        const service = await buildService();
        await service.onModuleInit();
        await waitFor(
          async () => {
            const snapshot = service.getRunnerHealthSnapshot();
            return snapshot.length === tenants.length;
          },
          { timeoutMs: 15_000 },
        );

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
        await Bun.sleep(150);
        await service.onModuleDestroy();

        for (let n = killThreshold; n < totalEvents; n++) await publishOne(n);
        expect(publishedCount).toBe(totalEvents);

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

        await waitFor(async () => (await totalMirrorCount()) >= totalEvents, {
          timeoutMs: 60_000,
          intervalMs: 250,
        });

        const finalCount = await totalMirrorCount();
        expect(finalCount).toBe(totalEvents);

        for (let i = 0; i < tenants.length; i++) {
          const t = tenants[i]!;
          const c = await t.db
            .collection("http_adapters")
            .countDocuments({ managed_by: "registry-service" });
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

        await Bun.sleep(500);

        const afterRows = await totalMirrorCount();
        expect(afterRows).toBe(beforeRows);

        for (let i = 0; i < tenants.length; i++) {
          const t = tenants[i]!;
          const rows = await t.db
            .collection("http_adapters")
            .find({ name: "svc-cross-tenant-poison" })
            .toArray();
          expect(rows).toHaveLength(0);
        }

        crossSpy.mockRestore();
        await service.onModuleDestroy();
      },
      120_000,
    );
  },
);
