import { describe, it, expect, mock, beforeEach } from "bun:test";
import { SharedTenantDatabaseMode } from "@yoizen/database";
import type { Db } from "mongodb";
import { UsageMongoRepository } from "../../src/modules/usage/usage.mongo.repository";
import type { UsageTenantConnectionManager } from "../../src/modules/usage/tenant-connection-manager";

interface IAggregateCall {
  readonly pipeline: readonly unknown[];
}

function makeDb(rows: unknown[]): {
  db: Db;
  calls: IAggregateCall[];
} {
  const calls: IAggregateCall[] = [];
  const aggregate = mock((pipeline: readonly unknown[]) => {
    calls.push({ pipeline });
    return { toArray: mock(async () => rows) };
  });
  const db = {
    collection: mock(() => ({ aggregate })),
  } as unknown as Db;
  return { db, calls };
}

function makeConnections(db: Db): UsageTenantConnectionManager {
  return {
    ensureSchema: mock(() => Promise.resolve(db)),
    resolveDatabaseTarget: mock(() =>
      Promise.resolve({
        tier: "dedicated",
        host: "mongo-usage.tenant-1-dev-ns.svc.cluster.local",
        port: 27017,
        database: "yoizen",
        sharedDatabaseMode: null,
      }),
    ),
  } as unknown as UsageTenantConnectionManager;
}

function makeSharedConnections(db: Db): UsageTenantConnectionManager {
  return {
    ensureSchema: mock(() => Promise.resolve(db)),
    resolveDatabaseTarget: mock(() =>
      Promise.resolve({
        tier: "shared",
        host: "mongo-usage-shared.support-services-dev.svc.cluster.local",
        port: 27017,
        database: "yoizen_usage",
        sharedDatabaseMode: SharedTenantDatabaseMode.SingleDatabase,
      }),
    ),
  } as unknown as UsageTenantConnectionManager;
}

describe("UsageMongoRepository", () => {
  let repo: UsageMongoRepository;

  beforeEach(() => {
    const { db } = makeDb([]);
    repo = new UsageMongoRepository(makeConnections(db));
  });

  it("aggregates hourly buckets with $dateTrunc and normalises rows", async () => {
    const { db, calls } = makeDb([
      {
        _id: {
          bucket: new Date("2026-04-23T09:00:00.000Z"),
          account_id: "acct-1",
          channel: "whatsapp",
          direction: "ingress",
        },
        events: 42,
      },
    ]);
    repo = new UsageMongoRepository(makeConnections(db));

    const rows = await repo.getBuckets({
      tenantId: "tenant-1",
      from: new Date("2026-04-20T00:00:00Z"),
      to: new Date("2026-04-23T00:00:00Z"),
      bucket: "hour",
    });

    expect(calls).toHaveLength(1);
    const pipeline = calls[0]!.pipeline;
    expect(JSON.stringify(pipeline)).toContain("$dateTrunc");
    expect(JSON.stringify(pipeline)).toContain('"unit":"hour"');
    expect(rows).toEqual([
      {
        bucket: "2026-04-23T09:00:00.000Z",
        accountId: "acct-1",
        channel: "whatsapp",
        direction: "ingress",
        events: 42,
      },
    ]);
  });

  it("uses day unit when bucket=day", async () => {
    const { db, calls } = makeDb([]);
    repo = new UsageMongoRepository(makeConnections(db));
    await repo.getBuckets({
      tenantId: "tenant-1",
      from: new Date("2026-04-01T00:00:00Z"),
      to: new Date("2026-04-23T00:00:00Z"),
      bucket: "day",
    });
    expect(JSON.stringify(calls[0]!.pipeline)).toContain('"unit":"day"');
  });

  it("filters shared Mongo queries by meta.tenant_id", async () => {
    const { db, calls } = makeDb([]);
    repo = new UsageMongoRepository(makeSharedConnections(db));
    await repo.getBuckets({
      tenantId: "tenant-1",
      from: new Date("2026-04-20T00:00:00Z"),
      to: new Date("2026-04-23T00:00:00Z"),
      bucket: "hour",
    });
    const matchStage = calls[0]!.pipeline[0] as { $match: Record<string, unknown> };
    expect(matchStage.$match["meta.tenant_id"]).toBe("tenant-1");
  });

  it("binds accountId/channel/direction filters in $match", async () => {
    const { db, calls } = makeDb([]);
    repo = new UsageMongoRepository(makeConnections(db));
    await repo.getBuckets({
      tenantId: "tenant-1",
      from: new Date("2026-04-20T00:00:00Z"),
      to: new Date("2026-04-23T00:00:00Z"),
      bucket: "hour",
      accountId: "acct-1",
      channel: "whatsapp",
      direction: "egress",
    });
    const matchStage = calls[0]!.pipeline[0] as { $match: Record<string, unknown> };
    expect(matchStage.$match["meta.account_id"]).toBe("acct-1");
    expect(matchStage.$match["meta.channel_id"]).toBe("whatsapp");
    expect(matchStage.$match.direction).toBe("egress");
  });

  it("aggregates totals per direction with first/last ts", async () => {
    const { db, calls } = makeDb([
      {
        _id: "ingress",
        events: 100,
        first_ts: new Date("2026-04-20T10:00:00Z"),
        last_ts: new Date("2026-04-22T15:30:00Z"),
      },
      {
        _id: "egress",
        events: 50,
        first_ts: new Date("2026-04-21T08:00:00Z"),
        last_ts: new Date("2026-04-21T18:00:00Z"),
      },
    ]);
    repo = new UsageMongoRepository(makeConnections(db));
    const rows = await repo.getTotals({
      tenantId: "tenant-1",
      from: new Date("2026-04-20T00:00:00Z"),
      to: new Date("2026-04-23T00:00:00Z"),
    });
    expect(JSON.stringify(calls[0]!.pipeline)).toContain("$min");
    expect(rows).toEqual([
      {
        direction: "ingress",
        events: 100,
        firstTs: "2026-04-20T10:00:00.000Z",
        lastTs: "2026-04-22T15:30:00.000Z",
      },
      {
        direction: "egress",
        events: 50,
        firstTs: "2026-04-21T08:00:00.000Z",
        lastTs: "2026-04-21T18:00:00.000Z",
      },
    ]);
  });
});
