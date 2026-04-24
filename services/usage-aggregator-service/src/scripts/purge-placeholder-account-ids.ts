/**
 * One-shot cleanup: removes `channel_events` rows where `account_id`
 * holds a tenant-id placeholder (the legacy value emitted by
 * `api-gateway` before `accountid` was removed from
 * `WebhookIngressEnvelope`). Also refreshes the continuous
 * aggregates (`channel_events_hourly` / `channel_events_daily`) over
 * the affected time window so dashboards reflect reality.
 *
 * Run via:
 *   PURGE_TENANT_IDS=acme,other-tenant \
 *   POSTGRES_PASSWORD=... \
 *   PLATFORM_ENVIRONMENT=dev \
 *   bun run src/scripts/purge-placeholder-account-ids.ts
 *
 * Env:
 *   PURGE_TENANT_IDS     Comma-separated tenant ids to clean (required).
 *   PURGE_DRY_RUN        Set to "1" / "true" to count-only, skip DELETE.
 *   POSTGRES_PASSWORD    Credentials for `postgres-usage` (inherited).
 *   POSTGRES_USER        Optional (defaults to `yoizen`).
 *   POSTGRES_PORT        Optional (defaults to `5432`).
 *   PLATFORM_ENVIRONMENT Used to resolve `postgres-usage.<tenant>-<env>-ns`.
 *
 * Idempotent: re-running after the deletes is a no-op. Safe to run
 * while the aggregator is live — row-level deletes are fast and the
 * CAGG refresh is online.
 *
 * Complexity: O(R) per tenant where R is the number of bad rows
 * (bounded by the 60-day retention × webhook QPS). The CAGG refresh
 * is O(C) where C is the number of chunks intersecting the deleted
 * range; in practice a handful of hourly buckets.
 */
import "reflect-metadata";
import { UsageTenantConnectionManager } from "../providers/tenant-connection-manager";

/** Isolated summary per tenant — `Map`-friendly shape. */
interface IPurgeSummary {
  readonly tenantId: string;
  readonly matched: number;
  readonly deleted: number;
  readonly minTs: Date | null;
  readonly maxTs: Date | null;
  readonly dryRun: boolean;
}

function parseTenantIds(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  /**
   * `Set` to dedupe on the fly in O(n); we don't need ordering, and
   * duplicate tenant ids would double the work without changing the
   * result.
   */
  const unique = new Set<string>();
  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (trimmed.length > 0) unique.add(trimmed);
  }
  return Array.from(unique);
}

function parseBoolean(raw: string | undefined): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

async function purgeTenant(
  connections: UsageTenantConnectionManager,
  tenantId: string,
  dryRun: boolean,
): Promise<IPurgeSummary> {
  const sql = await connections.ensureSchema(tenantId);

  /**
   * Two-step: first inspect (count + time bounds) so we can refresh
   * CAGGs only over the affected range, then delete. Keeping them
   * separate also lets us surface a diff even in `--dry-run` mode.
   */
  const [probe] = await sql<
    { matched: string; min_ts: Date | null; max_ts: Date | null }[]
  >`
    SELECT count(*)::text AS matched,
           min(ts)        AS min_ts,
           max(ts)        AS max_ts
      FROM channel_events
     WHERE account_id = ${tenantId}
  `;

  const matched = Number(probe?.matched ?? 0);
  const minTs = probe?.min_ts ?? null;
  const maxTs = probe?.max_ts ?? null;

  if (matched === 0 || dryRun) {
    return { tenantId, matched, deleted: 0, minTs, maxTs, dryRun };
  }

  const deleted = await sql`
    DELETE FROM channel_events
     WHERE account_id = ${tenantId}
  `;

  /**
   * Refresh only the touched buckets. TimescaleDB requires a closed
   * `[start, end)` window; we pad by one bucket on each side to
   * absorb boundary timestamps and truncate against `now()` because
   * CAGG policies forbid refreshing into the `end_offset` window
   * (15 minutes here matches the looser of the two policies).
   */
  if (minTs && maxTs) {
    const refreshStart = new Date(minTs.getTime() - 60 * 60 * 1000);
    const refreshEnd = new Date(
      Math.min(maxTs.getTime() + 60 * 60 * 1000, Date.now() - 15 * 60 * 1000),
    );
    if (refreshEnd.getTime() > refreshStart.getTime()) {
      await sql`
        CALL refresh_continuous_aggregate(
          'channel_events_hourly',
          ${refreshStart}::timestamptz,
          ${refreshEnd}::timestamptz
        )
      `;
      await sql`
        CALL refresh_continuous_aggregate(
          'channel_events_daily',
          ${refreshStart}::timestamptz,
          ${refreshEnd}::timestamptz
        )
      `;
    }
  }

  return {
    tenantId,
    matched,
    deleted: deleted.count ?? matched,
    minTs,
    maxTs,
    dryRun,
  };
}

async function main(): Promise<void> {
  const tenantIds = parseTenantIds(process.env.PURGE_TENANT_IDS);
  if (tenantIds.length === 0) {
    console.error(
      "PURGE_TENANT_IDS is required (comma-separated list of tenant ids)",
    );
    process.exit(2);
  }

  const dryRun = parseBoolean(process.env.PURGE_DRY_RUN);
  const connections = new UsageTenantConnectionManager();

  try {
    for (const tenantId of tenantIds) {
      console.log(
        `[purge] tenant=${tenantId} starting… dryRun=${dryRun}`,
      );
      const summary = await purgeTenant(connections, tenantId, dryRun);
      console.log(`[purge] ${JSON.stringify(summary)}`);
    }
  } finally {
    await connections.onModuleDestroy();
  }
}

main().catch((err) => {
  console.error(`[purge] fatal: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
