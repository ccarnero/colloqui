import { describe, expect, it, mock } from "bun:test";
import { SharedTenantDatabaseMode } from "@yoizen/database";
import type { UsageTenantConnectionManager } from "../../src/modules/usage/tenant-connection-manager";
import { UsagePostgresRepository } from "../../src/modules/usage/usage.postgres.repository";

/**
 * `getSummary` regression coverage.
 *
 * Root cause of the 500 (`column "events" does not exist`): the raw
 * `channel_events` hypertable has no `events` column — only the
 * continuous-aggregate views (`channel_events_hourly`/`_daily`) precompute
 * `count(*) AS events`. `getSummary` queried the raw table with
 * `SUM(events)`, which fails. The fix mirrors `getTotals`, which already
 * reads the raw table correctly via `count(*)::BIGINT AS events`.
 */

interface ISqlCall {
  readonly query: string;
  readonly params: readonly unknown[];
}

function makeSqlUnsafe(rows: unknown[]): {
  sql: { unsafe: (query: string, params?: unknown[]) => Promise<unknown[]> };
  calls: ISqlCall[];
} {
  const calls: ISqlCall[] = [];
  const unsafe = mock(async (query: string, params: unknown[] = []) => {
    calls.push({ query, params });
    return rows;
  });
  return { sql: { unsafe }, calls };
}

function makeConnections(
  sql: unknown,
  sharedDatabaseMode: string | null = null
): UsageTenantConnectionManager {
  return {
    ensureSchema: mock(() => Promise.resolve(sql)),
    resolveDatabaseTarget: mock(() => Promise.resolve({ sharedDatabaseMode })),
  } as unknown as UsageTenantConnectionManager;
}

describe("UsagePostgresRepository.getSummary", () => {
  it("dedicated tier: counts rows from raw channel_events instead of SUM(events)", async () => {
    const { sql, calls } = makeSqlUnsafe([
      { channel: "telegram", direction: "ingress", events: "12" },
    ]);
    const repo = new UsagePostgresRepository(makeConnections(sql));

    const rows = await repo.getSummary("tenant-1");

    expect(calls).toHaveLength(1);
    const query = calls[0]!.query;
    expect(query).toContain("count(*)::BIGINT AS events");
    expect(query).not.toContain("SUM(events)");
    expect(query).toContain("FROM channel_events");
    expect(query).not.toMatch(/FROM channel_events_(hourly|daily)/);
    expect(rows).toEqual([
      { channel: "telegram", direction: "ingress", events: 12 },
    ]);
  });

  it("shared tier: counts rows from raw channel_events scoped by tenant_id", async () => {
    const { sql, calls } = makeSqlUnsafe([
      { channel: "http", direction: "egress", events: "3" },
    ]);
    const repo = new UsagePostgresRepository(
      makeConnections(sql, SharedTenantDatabaseMode.SingleDatabase)
    );

    const rows = await repo.getSummary("tenant-2");

    expect(calls).toHaveLength(1);
    const { query, params } = calls[0]!;
    expect(query).toContain("count(*)::BIGINT AS events");
    expect(query).not.toContain("SUM(events)");
    expect(query).toContain("WHERE tenant_id = $1");
    expect(params).toEqual(["tenant-2"]);
    expect(rows).toEqual([
      { channel: "http", direction: "egress", events: 3 },
    ]);
  });
});
