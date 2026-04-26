import { describe, it, expect, mock, beforeEach } from "bun:test";
import { UsageRepository } from "../../src/modules/usage/usage.repository";
import type { UsageTenantConnectionManager } from "../../src/modules/usage/tenant-connection-manager";

interface IUnsafeCall {
  readonly query: string;
  readonly params: readonly unknown[];
}

function makeSql(rows: unknown[]) {
  const calls: IUnsafeCall[] = [];
  const unsafe = mock((query: string, params: readonly unknown[]) => {
    calls.push({ query, params });
    return Promise.resolve(rows);
  });
  return {
    sql: { unsafe } as unknown as Awaited<
      ReturnType<UsageTenantConnectionManager["ensureSchema"]>
    >,
    calls,
  };
}

function makeConnections(sql: unknown): UsageTenantConnectionManager {
  return {
    ensureSchema: mock(() => Promise.resolve(sql)),
  } as unknown as UsageTenantConnectionManager;
}

describe("UsageRepository", () => {
  let repo: UsageRepository;

  beforeEach(() => {
    const { sql } = makeSql([]);
    repo = new UsageRepository(makeConnections(sql));
  });

  it("queries the hourly view with a raw tail and normalises rows", async () => {
    const { sql, calls } = makeSql([
      {
        bucket: "2026-04-23T09:00:00.000Z",
        account_id: "acct-1",
        channel: "whatsapp",
        direction: "ingress",
        events: "42",
      },
    ]);
    repo = new UsageRepository(makeConnections(sql));

    const rows = await repo.getBuckets({
      tenantId: "tenant-1",
      from: new Date("2026-04-20T00:00:00Z"),
      to: new Date("2026-04-23T00:00:00Z"),
      bucket: "hour",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toContain("FROM channel_events_hourly");
    expect(calls[0]!.query).toContain("FROM channel_events");
    expect(calls[0]!.query).toContain("UNION ALL");
    expect(calls[0]!.query).toContain("time_bucket($6::interval, ts)");
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

  it("queries the daily view when bucket=day", async () => {
    const { sql, calls } = makeSql([]);
    repo = new UsageRepository(makeConnections(sql));
    await repo.getBuckets({
      tenantId: "tenant-1",
      from: new Date("2026-04-01T00:00:00Z"),
      to: new Date("2026-04-23T00:00:00Z"),
      bucket: "day",
    });
    expect(calls[0]!.query).toContain("FROM channel_events_daily");
    expect(calls[0]!.params[5]).toBe("1 day");
  });

  it("binds accountId/channel/direction filters as parameters", async () => {
    const { sql, calls } = makeSql([]);
    repo = new UsageRepository(makeConnections(sql));
    await repo.getBuckets({
      tenantId: "tenant-1",
      from: new Date("2026-04-20T00:00:00Z"),
      to: new Date("2026-04-23T00:00:00Z"),
      bucket: "hour",
      accountId: "acct-1",
      channel: "whatsapp",
      direction: "egress",
    });
    expect(calls[0]!.params).toEqual([
      new Date("2026-04-20T00:00:00Z"),
      new Date("2026-04-23T00:00:00Z"),
      "acct-1",
      "whatsapp",
      "egress",
      "1 hour",
    ]);
  });

  it("aggregates totals per direction from channel_events with first/last ts", async () => {
    const { sql, calls } = makeSql([
      {
        direction: "ingress",
        events: "100",
        first_ts: new Date("2026-04-20T10:00:00Z"),
        last_ts: new Date("2026-04-22T15:30:00Z"),
      },
      {
        direction: "egress",
        events: "50",
        first_ts: new Date("2026-04-21T08:00:00Z"),
        last_ts: new Date("2026-04-21T18:00:00Z"),
      },
    ]);
    repo = new UsageRepository(makeConnections(sql));
    const rows = await repo.getTotals({
      tenantId: "tenant-1",
      from: new Date("2026-04-20T00:00:00Z"),
      to: new Date("2026-04-23T00:00:00Z"),
    });
    expect(calls[0]!.query).toContain("FROM channel_events");
    expect(calls[0]!.query).toContain("MIN(ts)");
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
