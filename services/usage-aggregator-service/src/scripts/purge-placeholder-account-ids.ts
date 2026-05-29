/**
 * One-shot cleanup: removes `channel_events` rows where `meta.account_id`
 * holds a tenant-id placeholder (legacy value from api-gateway before
 * `accountid` was required on channel envelopes).
 *
 * Run via:
 *   PURGE_TENANT_IDS=acme,other-tenant \
 *   MONGO_PASSWORD=... \
 *   PLATFORM_ENVIRONMENT=dev \
 *   bun run src/scripts/purge-placeholder-account-ids.ts
 */
import "reflect-metadata";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import { usageAggregatorServiceConfig } from "../config";
import { UsageTenantConnectionManagerMongo } from "../providers/tenant-connection-manager.mongo";
import { UsageTenantConnectionManagerPostgres } from "../providers/tenant-connection-manager.postgres";

interface IPurgeSummary {
  readonly tenantId: string;
  readonly matched: number;
  readonly deleted: number;
  readonly minTs: Date | null;
  readonly maxTs: Date | null;
  readonly dryRun: boolean;
}

interface IProbeRow {
  readonly matched: number;
  readonly min_ts: Date | null;
  readonly max_ts: Date | null;
}

function parseTenantIds(raw: string | undefined): readonly string[] {
  if (!raw) return [];
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

function createConnections():
  | TenantMongoConnectionManager
  | TenantConnectionManager {
  return usageAggregatorServiceConfig.dbEngine === "postgres"
    ? new UsageTenantConnectionManagerPostgres()
    : new UsageTenantConnectionManagerMongo();
}

async function purgeTenant(
  connections: TenantMongoConnectionManager | TenantConnectionManager,
  tenantId: string,
  dryRun: boolean,
): Promise<IPurgeSummary> {
  if (usageAggregatorServiceConfig.dbEngine !== "mongo") {
    throw new Error(
      "purge-placeholder-account-ids currently supports mongo usage storage only",
    );
  }

  const mongoConnections = connections as TenantMongoConnectionManager;
  const db = await mongoConnections.ensureSchema(tenantId);
  const target = await mongoConnections.resolveDatabaseTarget(tenantId);
  const isShared =
    target.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase;
  const match: Record<string, unknown> = {
    "meta.account_id": tenantId,
  };
  if (isShared) {
    match["meta.tenant_id"] = tenantId;
  }

  const probeRows = await db
    .collection("channel_events")
    .aggregate<IProbeRow>([
      { $match: match },
      {
        $group: {
          _id: null,
          matched: { $sum: 1 },
          min_ts: { $min: "$ts" },
          max_ts: { $max: "$ts" },
        },
      },
    ])
    .toArray();

  const probe = probeRows[0];
  const matched = probe?.matched ?? 0;
  const minTs = probe?.min_ts ?? null;
  const maxTs = probe?.max_ts ?? null;

  if (matched === 0 || dryRun) {
    return { tenantId, matched, deleted: 0, minTs, maxTs, dryRun };
  }

  const deleted = await db.collection("channel_events").deleteMany(match);

  return {
    tenantId,
    matched,
    deleted: deleted.deletedCount,
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
  const connections = createConnections();

  try {
    for (const tenantId of tenantIds) {
      console.log(`[purge] tenant=${tenantId} starting… dryRun=${dryRun}`);
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
