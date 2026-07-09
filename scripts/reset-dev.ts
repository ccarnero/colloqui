#!/usr/bin/env bun
/**
 * reset-dev.ts — idempotent, dry-run-by-default reset of dev-environment
 * MESSAGE DATA left behind by old/fixed integration-test runs.
 *
 * Wipes (see RESET-INVENTORY.md at the repo root for the full audit this
 * script implements):
 *   - JetStream stream contents (INGRESS-*, DLQ-*, GATEWAY_AUDIT,
 *     PLATFORM_TENANTS, the legacy global DLQ stream if it still exists,
 *     and claim-check payload blobs in every PAYLOAD-<tenant> bucket)
 *   - Per-tenant Postgres tables and Mongo collections holding messages,
 *     events, run/execution results, and conversation memory
 *   - The shared usage-aggregator Timescale DB (optional stage)
 *   - Derived Redis caches, counters, and circuit-breaker state
 *
 * NEVER touches: stream/consumer/bucket *definitions* (topology), the
 * tenant registry, credentials, schemas, or connector/channel/agent
 * CONFIGURATION. Also deliberately EXCLUDES the `credentials`
 * table/collection even though RESET-INVENTORY.md's DUDOSO section was
 * approved wholesale — it holds real per-tenant connector secrets, not
 * test-run residue, and wiping it is out of scope for "clean up old
 * failed test runs." Everything else flagged DUDOSO (agent_versions,
 * document_chunks[_embedding], canary_deployments, adapter:oauth:*
 * Redis keys, the legacy global DLQ stream) IS included below.
 *
 * Usage:
 *   bun run scripts/reset-dev.ts                # dry-run (default): prints counts only
 *   bun run scripts/reset-dev.ts --apply         # deletes; asks for a typed "yes" first
 *   bun run scripts/reset-dev.ts --apply --yes   # deletes; no prompt (CI/scripted use)
 *
 * Prerequisite: `pnpm install` at the repo root at least once (this
 * script depends on postgres/mongodb/ioredis/nats/@yoizen/database,
 * added to the root package.json devDependencies alongside this file).
 *
 * Required env vars — no defaults. Missing any of these aborts before
 * any connection is opened, listing every missing name at once:
 *   NATS_URL
 *   POSTGRES_HOST POSTGRES_PORT POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
 *   TENANT_POSTGRES_SHARED_HOST TENANT_POSTGRES_SHARED_PORT
 *   MONGO_HOST MONGO_PORT MONGO_USER MONGO_PASSWORD MONGO_DB
 *   TENANT_MONGO_SHARED_HOST TENANT_MONGO_SHARED_PORT
 *   REDIS_HOST REDIS_PORT
 *
 * Optional (per-tenant Postgres/Mongo shared-cluster credentials — these
 * legitimately fall back to the catalog credentials/tenant role-name
 * convention already built into TenantConnectionManager/
 * TenantMongoConnectionManager, so they are NOT treated as risky
 * location defaults the way HOST/PORT are):
 *   TENANT_POSTGRES_SHARED_USER TENANT_POSTGRES_SHARED_PASSWORD
 *   TENANT_MONGO_SHARED_USER TENANT_MONGO_SHARED_PASSWORD
 *
 * Optional STAGE (usage-aggregator's shared Timescale DB) — skipped
 * entirely, with a logged reason, if any of these five are unset. Not
 * defaulted:
 *   USAGE_POSTGRES_HOST USAGE_POSTGRES_PORT USAGE_POSTGRES_USER
 *   USAGE_POSTGRES_PASSWORD USAGE_POSTGRES_DB
 */

import "reflect-metadata";
import {
  TenantConnectionManager,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import Redis from "ioredis";
import { MongoClient } from "mongodb";
import { connect as natsConnect } from "nats";
import postgres from "postgres";

// ---------------------------------------------------------------------------
// Result type — this script's own local convention (the repo has no
// shared Result<T,E> helper; introduced here because reset-dev.ts asked
// for one explicitly, not because the codebase uses this pattern elsewhere).
// ---------------------------------------------------------------------------

type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const fail = <E>(error: E): Result<never, E> => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Pure: classification tables (mirrors RESET-INVENTORY.md)
// ---------------------------------------------------------------------------

/**
 * Per-tenant Postgres DATA tables truncated independently (no FK between
 * them). `document_chunks` / `document_chunks_embedding` are handled
 * separately below — Postgres refuses to TRUNCATE a table that another
 * live table still has an FK pointing at, even if that other table is
 * already empty, so both must be truncated together in one statement.
 */
const TENANT_POSTGRES_TABLES: readonly string[] = [
  "events",
  "channel_events",
  "execution_events",
  "gateway_audit_events",
  "mcp_call_events",
  "workflow_executions",
  "job_executions",
  "skb_query_history",
  "memories",
  "agent_versions",
];

/** Tables truncated together in a single statement because of an FK between them (document_chunks_embedding.chunk_id -> document_chunks.id). */
const DOCUMENT_CHUNK_TABLE_GROUP: readonly string[] = [
  "document_chunks_embedding",
  "document_chunks",
];

/** Per-tenant Mongo DATA collections. */
const TENANT_MONGO_COLLECTIONS: readonly string[] = [
  "events",
  "gateway_audit_events",
  "channel_events",
  "execution_events",
  "job_executions",
  "mcp_call_events",
  "workflow_executions",
  "agent_versions",
];

/** Catalog-level (single platform DB, not per-tenant) DATA table/collection. */
const CATALOG_TABLE = "canary_deployments";
const CATALOG_COLLECTION = "canary_deployments";

/** Shared usage-aggregator Timescale DB DATA tables (optional stage). */
const USAGE_POSTGRES_TABLES: readonly string[] = [
  "connector_call_events",
  "channel_events",
];

/** Redis key patterns. `adapter:oauth:*` is included per explicit approval of RESET-INVENTORY.md's DUDOSO section. */
const REDIS_PATTERNS: readonly string[] = [
  "pending:*",
  "*:pending:*",
  "result:*",
  "*:result:*",
  "callback:*",
  "public_routes:*",
  "dashboard:stats:*",
  "ratelimit:*",
  "agent-ai:costs:*",
  "platform:admin:runtime:last_sync:*",
  "adapter:config:*",
  "adapter:oauth:*",
  "adapter:internal-by-service:*",
  "httpcache:v1:*",
  "cb:channel:egress",
  "cb:workflow:http",
  "cb:workflow:agent",
];

function classifyStream(name: string): "data" | "unknown" {
  if (/^INGRESS-/.test(name)) {
    return "data";
  }
  if (/^DLQ-/.test(name)) {
    return "data";
  }
  if (name === "DLQ") {
    return "data"; // legacy global stream, RESET-INVENTORY.md DUDOSO #1
  }
  if (name === "GATEWAY_AUDIT") {
    return "data";
  }
  if (name === "PLATFORM_TENANTS") {
    return "data";
  }
  if (/^OBJ_PAYLOAD-/.test(name)) {
    return "data"; // claim-check bucket, backed by a stream
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Pure: env validation
// ---------------------------------------------------------------------------

const REQUIRED_ENV: readonly string[] = [
  "NATS_URL",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "TENANT_POSTGRES_SHARED_HOST",
  "TENANT_POSTGRES_SHARED_PORT",
  "REDIS_HOST",
  "REDIS_PORT",
];

/** Optional stage — this cluster currently has no MongoDB deployed (Postgres-only dev topology, confirmed live via `kubectl get pods`/`get svc` in support-services-dev: no mongo service/pod exists). Skipped with a logged reason if unset, never defaulted. */
const MONGO_STAGE_ENV: readonly string[] = [
  "MONGO_HOST",
  "MONGO_PORT",
  "MONGO_USER",
  "MONGO_PASSWORD",
  "MONGO_DB",
  "TENANT_MONGO_SHARED_HOST",
  "TENANT_MONGO_SHARED_PORT",
];

const USAGE_STAGE_ENV: readonly string[] = [
  "USAGE_POSTGRES_HOST",
  "USAGE_POSTGRES_PORT",
  "USAGE_POSTGRES_USER",
  "USAGE_POSTGRES_PASSWORD",
  "USAGE_POSTGRES_DB",
];

function missingEnvNames(names: readonly string[]): string[] {
  return names.filter((name) => !process.env[name]?.trim());
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface ILocationResult {
  readonly location: string;
  readonly kind:
    | "nats-stream"
    | "postgres-table"
    | "mongo-collection"
    | "redis-pattern";
  readonly before: number;
  readonly after: number;
  readonly note?: string;
}

function log(msg: string): void {
  console.log(`[reset-dev] ${msg}`);
}

// ---------------------------------------------------------------------------
// NATS JetStream stage
// ---------------------------------------------------------------------------

async function runNatsStage(
  natsUrl: string,
  dryRun: boolean,
  report: ILocationResult[]
): Promise<Result<void>> {
  log(`NATS: connecting to ${natsUrl}`);
  let nc;
  try {
    nc = await natsConnect({ servers: natsUrl });
  } catch (error) {
    return fail(
      `NATS connect failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    const jsm = await nc.jetstreamManager();
    const unknownStreams: string[] = [];

    for await (const info of jsm.streams.list()) {
      const name = info.config.name;
      const before = info.state.messages;
      const classification = classifyStream(name);

      if (classification === "unknown") {
        unknownStreams.push(name);
        continue;
      }

      if (dryRun) {
        report.push({
          location: `nats:${name}`,
          kind: "nats-stream",
          before,
          after: before,
          note: "dry-run — would purge all messages",
        });
        log(
          `  [dry-run] stream '${name}': ${before} message(s) would be purged`
        );
        continue;
      }

      await jsm.streams.purge(name);
      const after = (await jsm.streams.info(name)).state.messages;
      report.push({
        location: `nats:${name}`,
        kind: "nats-stream",
        before,
        after,
      });
      log(`  stream '${name}': purged (${before} -> ${after})`);
    }

    if (unknownStreams.length > 0) {
      log(
        `  NOT touched (unrecognized, not in RESET-INVENTORY.md): ${unknownStreams.join(", ")}`
      );
    }

    return ok(undefined);
  } catch (error) {
    return fail(
      `NATS stage failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await nc.drain();
  }
}

// ---------------------------------------------------------------------------
// Postgres stage — catalog cleanup + per-tenant loop
// ---------------------------------------------------------------------------

async function tableExists(
  sql: ReturnType<typeof postgres>,
  table: string
): Promise<boolean> {
  const [row] = await sql<{ reg: string | null }[]>`
    SELECT to_regclass(${"public." + table}) AS reg
  `;
  return row?.reg !== null && row?.reg !== undefined;
}

async function truncateOrCount(
  sql: ReturnType<typeof postgres>,
  location: string,
  table: string,
  dryRun: boolean,
  report: ILocationResult[]
): Promise<void> {
  const exists = await tableExists(sql, table);
  if (!exists) {
    report.push({
      location,
      kind: "postgres-table",
      before: 0,
      after: 0,
      note: "table not present — skipped",
    });
    return;
  }

  const [{ count }] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM ${sql(table)}
  `;
  const before = Number(count);

  if (dryRun) {
    report.push({
      location,
      kind: "postgres-table",
      before,
      after: before,
      note: "dry-run — would truncate",
    });
    log(`  [dry-run] ${location}: ${before} row(s) would be truncated`);
    return;
  }

  try {
    await sql`TRUNCATE TABLE ${sql(table)}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.push({
      location,
      kind: "postgres-table",
      before,
      after: before,
      note: `truncate failed: ${message}`,
    });
    log(`  ${location}: TRUNCATE FAILED (${message}) — row(s) left in place`);
    return;
  }
  const [{ count: afterCount }] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM ${sql(table)}
  `;
  const after = Number(afterCount);
  report.push({ location, kind: "postgres-table", before, after });
  log(`  ${location}: truncated (${before} -> ${after})`);
}

/**
 * Truncates a set of FK-linked tables in a single statement (Postgres
 * refuses to TRUNCATE a table that another live table still references,
 * even an already-empty one). Reports each table's before/after count
 * individually so the final report line-items stay uniform.
 */
async function truncateGroupOrCount(
  sql: ReturnType<typeof postgres>,
  locationPrefix: string,
  tables: readonly string[],
  dryRun: boolean,
  report: ILocationResult[]
): Promise<void> {
  const present: string[] = [];
  const beforeCounts = new Map<string, number>();
  for (const table of tables) {
    if (!(await tableExists(sql, table))) {
      report.push({
        location: `${locationPrefix}.${table}`,
        kind: "postgres-table",
        before: 0,
        after: 0,
        note: "table not present — skipped",
      });
      continue;
    }
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ${sql(table)}
    `;
    present.push(table);
    beforeCounts.set(table, Number(count));
  }

  if (present.length === 0) {
    return;
  }

  if (dryRun) {
    for (const table of present) {
      const before = beforeCounts.get(table)!;
      report.push({
        location: `${locationPrefix}.${table}`,
        kind: "postgres-table",
        before,
        after: before,
        note: "dry-run — would truncate (grouped, FK-linked)",
      });
      log(
        `  [dry-run] ${locationPrefix}.${table}: ${before} row(s) would be truncated (grouped)`
      );
    }
    return;
  }

  try {
    await sql`TRUNCATE TABLE ${sql(present)}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const table of present) {
      const before = beforeCounts.get(table)!;
      report.push({
        location: `${locationPrefix}.${table}`,
        kind: "postgres-table",
        before,
        after: before,
        note: `grouped truncate failed: ${message}`,
      });
    }
    log(`  ${locationPrefix} group truncate FAILED (${message})`);
    return;
  }

  for (const table of present) {
    const before = beforeCounts.get(table)!;
    const [{ count: afterCount }] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM ${sql(table)}
    `;
    const after = Number(afterCount);
    report.push({
      location: `${locationPrefix}.${table}`,
      kind: "postgres-table",
      before,
      after,
    });
    log(
      `  ${locationPrefix}.${table}: truncated (${before} -> ${after}, grouped)`
    );
  }
}

async function runPostgresStage(
  dryRun: boolean,
  report: ILocationResult[]
): Promise<Result<string[]>> {
  log("Postgres: connecting to catalog DB");
  const catalogSql = postgres({
    host: process.env.POSTGRES_HOST!,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB!,
    username: process.env.POSTGRES_USER!,
    password: process.env.POSTGRES_PASSWORD!,
    max: 5,
  });

  let tenantIds: string[];
  try {
    const rows = await catalogSql<
      { name: string }[]
    >`SELECT name FROM tenants ORDER BY name`;
    tenantIds = rows.map((r) => r.name);
    log(
      `Postgres: found ${tenantIds.length} tenant(s) in catalog: ${tenantIds.join(", ") || "(none)"}`
    );

    await truncateOrCount(
      catalogSql,
      "postgres:catalog.canary_deployments",
      CATALOG_TABLE,
      dryRun,
      report
    );
  } catch (error) {
    await catalogSql.end({ timeout: 5 });
    return fail(
      `Postgres catalog stage failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  await catalogSql.end({ timeout: 5 });

  const tenantManager = new TenantConnectionManager();
  try {
    for (const tenantId of tenantIds) {
      log(`Postgres: tenant '${tenantId}'`);
      let sql: ReturnType<typeof postgres>;
      try {
        sql = await tenantManager.ensureSchema(tenantId);
      } catch (error) {
        log(
          `  tenant '${tenantId}': could not resolve/connect (${error instanceof Error ? error.message : String(error)}) — skipping`
        );
        continue;
      }
      for (const table of TENANT_POSTGRES_TABLES) {
        await truncateOrCount(
          sql,
          `postgres:tenant_${tenantId}.${table}`,
          table,
          dryRun,
          report
        );
      }
      await truncateGroupOrCount(
        sql,
        `postgres:tenant_${tenantId}`,
        DOCUMENT_CHUNK_TABLE_GROUP,
        dryRun,
        report
      );
    }
  } finally {
    await tenantManager.onModuleDestroy();
  }

  return ok(tenantIds);
}

// ---------------------------------------------------------------------------
// Mongo stage — catalog cleanup + per-tenant loop
// ---------------------------------------------------------------------------

async function mongoDeleteOrCount(
  db: Awaited<ReturnType<MongoClient["db"]>>,
  location: string,
  collection: string,
  dryRun: boolean,
  report: ILocationResult[]
): Promise<void> {
  const existing = await db
    .listCollections({ name: collection }, { nameOnly: true })
    .toArray();
  if (existing.length === 0) {
    report.push({
      location,
      kind: "mongo-collection",
      before: 0,
      after: 0,
      note: "collection not present — skipped",
    });
    return;
  }

  const before = await db.collection(collection).countDocuments();

  if (dryRun) {
    report.push({
      location,
      kind: "mongo-collection",
      before,
      after: before,
      note: "dry-run — would delete all documents",
    });
    log(`  [dry-run] ${location}: ${before} document(s) would be deleted`);
    return;
  }

  await db.collection(collection).deleteMany({});
  const after = await db.collection(collection).countDocuments();
  report.push({ location, kind: "mongo-collection", before, after });
  log(`  ${location}: cleared (${before} -> ${after})`);
}

async function runMongoStage(
  tenantIds: readonly string[],
  dryRun: boolean,
  report: ILocationResult[]
): Promise<Result<void>> {
  log("Mongo: connecting to catalog DB");
  const catalogUri = `mongodb://${process.env.MONGO_USER}:${encodeURIComponent(process.env.MONGO_PASSWORD!)}@${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${process.env.MONGO_DB}`;
  const catalogClient = new MongoClient(catalogUri);

  try {
    await catalogClient.connect();
    const catalogDb = catalogClient.db(process.env.MONGO_DB!);
    await mongoDeleteOrCount(
      catalogDb,
      "mongo:catalog.canary_deployments",
      CATALOG_COLLECTION,
      dryRun,
      report
    );
  } catch (error) {
    await catalogClient.close();
    return fail(
      `Mongo catalog stage failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  await catalogClient.close();

  const tenantManager = new TenantMongoConnectionManager();
  try {
    for (const tenantId of tenantIds) {
      log(`Mongo: tenant '${tenantId}'`);
      let db: Awaited<ReturnType<MongoClient["db"]>>;
      try {
        db = await tenantManager.ensureSchema(tenantId);
      } catch (error) {
        log(
          `  tenant '${tenantId}': could not resolve/connect (${error instanceof Error ? error.message : String(error)}) — skipping`
        );
        continue;
      }
      for (const collection of TENANT_MONGO_COLLECTIONS) {
        await mongoDeleteOrCount(
          db,
          `mongo:tenant_${tenantId}.${collection}`,
          collection,
          dryRun,
          report
        );
      }
    }
  } finally {
    await tenantManager.onModuleDestroy();
  }

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Optional usage-DB stage (shared Timescale cluster)
// ---------------------------------------------------------------------------

async function runUsagePostgresStage(
  dryRun: boolean,
  report: ILocationResult[]
): Promise<Result<void>> {
  const missing = missingEnvNames(USAGE_STAGE_ENV);
  if (missing.length > 0) {
    log(
      `Usage-DB stage: skipped (optional, not configured) — missing: ${missing.join(", ")}`
    );
    return ok(undefined);
  }

  log("Usage-DB: connecting to shared Timescale DB");
  const sql = postgres({
    host: process.env.USAGE_POSTGRES_HOST!,
    port: Number(process.env.USAGE_POSTGRES_PORT),
    database: process.env.USAGE_POSTGRES_DB!,
    username: process.env.USAGE_POSTGRES_USER!,
    password: process.env.USAGE_POSTGRES_PASSWORD!,
    max: 5,
  });

  try {
    for (const table of USAGE_POSTGRES_TABLES) {
      await truncateOrCount(
        sql,
        `postgres:usage.${table}`,
        table,
        dryRun,
        report
      );
    }
    return ok(undefined);
  } catch (error) {
    return fail(
      `Usage-DB stage failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------------------
// Redis stage
// ---------------------------------------------------------------------------

async function scanCount(redis: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      500
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

async function runRedisStage(
  dryRun: boolean,
  report: ILocationResult[]
): Promise<Result<void>> {
  log(
    `Redis: connecting to ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
  );
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    lazyConnect: true,
  });

  try {
    await redis.connect();
    for (const pattern of REDIS_PATTERNS) {
      const keys = await scanCount(redis, pattern);
      const location = `redis:${pattern}`;

      if (dryRun) {
        report.push({
          location,
          kind: "redis-pattern",
          before: keys.length,
          after: keys.length,
          note: "dry-run — would unlink",
        });
        log(`  [dry-run] ${location}: ${keys.length} key(s) would be unlinked`);
        continue;
      }

      if (keys.length > 0) {
        await redis.unlink(...keys);
      }
      const after = (await scanCount(redis, pattern)).length;
      report.push({
        location,
        kind: "redis-pattern",
        before: keys.length,
        after,
      });
      log(`  ${location}: unlinked (${keys.length} -> ${after})`);
    }
    return ok(undefined);
  } catch (error) {
    return fail(
      `Redis stage failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    redis.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Reporting + verification
// ---------------------------------------------------------------------------

function printReport(
  report: readonly ILocationResult[],
  dryRun: boolean
): void {
  console.log("\n==================== RESET REPORT ====================");
  console.log(
    `${"location".padEnd(55)} ${"before".padStart(10)} ${"after".padStart(10)}  note`
  );
  for (const r of report) {
    console.log(
      `${r.location.padEnd(55)} ${String(r.before).padStart(10)} ${String(r.after).padStart(10)}  ${r.note ?? ""}`
    );
  }
  console.log("========================================================\n");

  if (dryRun) {
    const totalWouldDelete = report.reduce((sum, r) => sum + r.before, 0);
    log(
      `DRY-RUN complete. ${totalWouldDelete} item(s) across ${report.length} location(s) would be deleted.`
    );
    log("Re-run with --apply to actually delete.");
    return;
  }

  const notZero = report.filter(
    (r) => r.after !== 0 && !r.note?.includes("skipped")
  );
  if (notZero.length > 0) {
    log(
      `VERIFICATION FAILED — ${notZero.length} location(s) did not reach zero:`
    );
    for (const r of notZero) {
      log(`  ${r.location}: after=${r.after}`);
    }
  } else {
    log("VERIFICATION OK — every DATA location is at zero.");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function confirmApply(assumeYes: boolean): Promise<boolean> {
  if (assumeYes) {
    return true;
  }
  const answer = prompt("Type 'yes' to proceed with --apply: ");
  return answer?.trim().toLowerCase() === "yes";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--apply");
  const assumeYes = args.includes("--yes");

  const missing = missingEnvNames(REQUIRED_ENV);
  if (missing.length > 0) {
    console.error(
      `[reset-dev] Missing required env var(s):\n  ${missing.join("\n  ")}`
    );
    process.exit(2);
  }

  log(
    dryRun
      ? "Mode: DRY-RUN (default). Pass --apply to actually delete."
      : "Mode: APPLY"
  );

  if (!dryRun) {
    const confirmed = await confirmApply(assumeYes);
    if (!confirmed) {
      log("Aborted by user.");
      process.exit(1);
    }
  }

  const report: ILocationResult[] = [];
  let hadFailure = false;

  const natsResult = await runNatsStage(process.env.NATS_URL!, dryRun, report);
  if (!natsResult.ok) {
    console.error(`[reset-dev] ${natsResult.error}`);
    hadFailure = true;
  }

  const pgResult = await runPostgresStage(dryRun, report);
  if (!pgResult.ok) {
    console.error(`[reset-dev] ${pgResult.error}`);
    hadFailure = true;
  }
  const tenantIds = pgResult.ok ? pgResult.value : [];

  const missingMongo = missingEnvNames(MONGO_STAGE_ENV);
  if (missingMongo.length > 0) {
    log(
      `Mongo stage: skipped (optional, not configured) — missing: ${missingMongo.join(", ")}`
    );
  } else {
    const mongoResult = await runMongoStage(tenantIds, dryRun, report);
    if (!mongoResult.ok) {
      console.error(`[reset-dev] ${mongoResult.error}`);
      hadFailure = true;
    }
  }

  const usageResult = await runUsagePostgresStage(dryRun, report);
  if (!usageResult.ok) {
    console.error(`[reset-dev] ${usageResult.error}`);
    hadFailure = true;
  }

  const redisResult = await runRedisStage(dryRun, report);
  if (!redisResult.ok) {
    console.error(`[reset-dev] ${redisResult.error}`);
    hadFailure = true;
  }

  printReport(report, dryRun);

  if (hadFailure) {
    process.exit(1);
  }
  if (!dryRun) {
    const notZero = report.some(
      (r) => r.after !== 0 && !r.note?.includes("skipped")
    );
    process.exit(notZero ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`[reset-dev] fatal: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
