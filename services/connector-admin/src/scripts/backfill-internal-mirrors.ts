/**
 * One-shot backfill: walks every service registered in registry-service
 * and upserts a matching internal-adapter mirror in adapter-service.
 *
 * Run via: `bun run src/scripts/backfill-internal-mirrors.ts`
 *
 * Env:
 *   REGISTRY_SERVICE_URL (defaults to http://registry-service)
 *   BACKFILL_TENANT_IDS  (comma-separated tenant ids to backfill; required)
 *   POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_PORT
 *   PLATFORM_ENVIRONMENT (e.g. `dev`, `prod` — used to resolve per-tenant
 *                         Postgres host `postgres.<tenant>-<env>-ns.svc.cluster.local`)
 *
 * Idempotent: safe to re-run. Uses the same `upsertMirror()` path the
 * event-driven consumer uses, so the state-machine is identical.
 *
 * Each tenant's data lives in its own Postgres; the connection manager
 * routes queries to the right pool transparently.
 */
import "reflect-metadata";
import { resolveStorageEngine } from "@yoizen/database";
import {
  ADAPTER_MANAGED_BY_REGISTRY,
  AdapterStatus,
  TENANT_HEADER,
} from "@yoizen/shared";
import { AdaptersMongoRepository } from "../modules/adapters/adapters.mongo.repository";
import { AdaptersPostgresRepository } from "../modules/adapters/adapters.postgres.repository";
import type { IAdaptersRepository } from "../modules/adapters/adapters.repository.interface";
import { AdapterTenantConnectionManagerMongo } from "../providers/tenant-connection-manager.mongo";
import { AdapterTenantConnectionManagerPostgres } from "../providers/tenant-connection-manager.postgres";

interface IRegisteredServiceResponse {
  id: string;
  tenantId: string;
  name: string;
  port: number;
  status: string;
  knativeName: string | null;
  namespace: string | null;
}

interface IBackfillSummary {
  tenantId: string;
  processed: number;
  upserted: number;
  skipped: number;
  failed: number;
}

const REGISTRY_URL =
  process.env.REGISTRY_SERVICE_URL ?? "http://registry-service";

function parseTenantIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function fetchRegisteredServices(
  tenantId: string,
): Promise<IRegisteredServiceResponse[]> {
  const res = await fetch(`${REGISTRY_URL}/services`, {
    method: "GET",
    headers: { [TENANT_HEADER]: tenantId, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(
      `Registry list failed for tenant '${tenantId}': HTTP ${res.status}`,
    );
  }
  return (await res.json()) as IRegisteredServiceResponse[];
}

async function backfillTenant(
  repo: IAdaptersRepository,
  tenantId: string,
): Promise<IBackfillSummary> {
  const services = await fetchRegisteredServices(tenantId);
  let upserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const svc of services) {
    if (!svc.knativeName || !svc.namespace) {
      skipped++;
      continue;
    }
    const baseUrl = `http://${svc.knativeName}.${svc.namespace}.svc.cluster.local`;
    const status =
      svc.status === "active"
        ? AdapterStatus.ENABLED
        : AdapterStatus.DISABLED;
    try {
      await repo.upsertMirror({
        tenantId,
        serviceName: svc.name,
        baseUrl,
        healthCheckPath: "/health",
        status,
        managedBy: ADAPTER_MANAGED_BY_REGISTRY,
      });
      upserted++;
    } catch (err) {
      failed++;
      console.error(
        `[backfill] upsert failed for ${svc.name}@${tenantId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return {
    tenantId,
    processed: services.length,
    upserted,
    skipped,
    failed,
  };
}

async function main(): Promise<void> {
  const tenantIds = parseTenantIds(process.env.BACKFILL_TENANT_IDS);
  if (tenantIds.length === 0) {
    console.error(
      "BACKFILL_TENANT_IDS is required (comma-separated list of tenant ids)",
    );
    process.exit(2);
  }

  const engine = resolveStorageEngine();

  if (engine === "postgres") {
    const connections = new AdapterTenantConnectionManagerPostgres();
    const repo = new AdaptersPostgresRepository(connections);
    try {
      for (const tenantId of tenantIds) {
        console.log(`[backfill] tenant=${tenantId} starting…`);
        const summary = await backfillTenant(repo, tenantId);
        console.log(`[backfill] ${JSON.stringify(summary)}`);
      }
    } finally {
      await connections.onModuleDestroy();
    }
    return;
  }

  const connections = new AdapterTenantConnectionManagerMongo();
  const repo = new AdaptersMongoRepository(connections);

  try {
    for (const tenantId of tenantIds) {
      console.log(`[backfill] tenant=${tenantId} starting…`);
      const summary = await backfillTenant(repo, tenantId);
      console.log(`[backfill] ${JSON.stringify(summary)}`);
    }
  } finally {
    await connections.onModuleDestroy();
  }
}

main().catch((err) => {
  console.error(`[backfill] fatal: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
