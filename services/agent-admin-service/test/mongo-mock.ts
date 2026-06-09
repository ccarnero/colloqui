import { vi } from "bun:test";
import type { Db } from "mongodb";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";

export function createMockDb(handlers: Record<string, Record<string, unknown>>): Db {
  return {
    collection: vi.fn((name: string) => handlers[name] ?? {}),
  } as unknown as Db;
}

export function createMockTenantManager(db: Db): YoizenclawTenantConnectionManager {
  return {
    ensureSchema: vi.fn(async () => db),
    getConnection: vi.fn(() => db),
    probeFirstPool: vi.fn(async () => true),
    verifyConnectivity: vi.fn(async () => true),
    getKnownTenantIds: vi.fn(() => []),
    evictTenant: vi.fn(async () => undefined),
  } as unknown as YoizenclawTenantConnectionManager;
}
