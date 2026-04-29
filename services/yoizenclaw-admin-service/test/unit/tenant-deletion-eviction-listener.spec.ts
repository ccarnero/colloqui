import "../setup-env";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { TenantConnectionManager } from "@yoizen/database";
import { TenantDeletionEvictionListener } from "../../src/providers/tenant-deletion-eviction-listener";

interface IFakeLazyNats {
  getConnection: ReturnType<typeof mock>;
}

class HarnessListener extends TenantDeletionEvictionListener {
  public callHandle(payload: Uint8Array): Promise<void> {
    return (
      this as unknown as { handle: (p: Uint8Array) => Promise<void> }
    ).handle(payload);
  }
}

function buildHarness(): {
  listener: HarnessListener;
  evict: ReturnType<typeof mock>;
} {
  const evict = mock(() => Promise.resolve());
  const fakeLazy: IFakeLazyNats = {
    getConnection: mock(() =>
      Promise.reject(new Error("not used in unit tests")),
    ),
  };
  const fakeManager = { evictTenant: evict } as unknown as TenantConnectionManager;
  const listener = new HarnessListener(fakeLazy as never, fakeManager);
  return { listener, evict };
}

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

describe("admin TenantDeletionEvictionListener.handle", () => {
  let evict: ReturnType<typeof mock>;
  let listener: HarnessListener;

  beforeEach(() => {
    const built = buildHarness();
    evict = built.evict;
    listener = built.listener;
  });

  afterEach(() => {
    evict.mockReset();
  });

  it("evicts pools by SLUG (not the platform UUID) on a valid v1 deletion message", async () => {
    // Use distinct UUID + slug so the test pins the actual production wire
    // contract (`tenantId = row.id`, `name = row.name`). This regression
    // test catches the case where the listener forwards `parsed.tenantId`
    // (UUID) into `evictTenant` — which is a silent no-op because
    // TenantConnectionManager keys all caches by slug.
    await listener.callHandle(
      encode({
        schemaVersion: 1,
        tenantId: "550e8400-e29b-41d4-a716-446655440000",
        name: "acme",
      }),
    );
    expect(evict.mock.calls).toEqual([["acme"]]);
  });

  it("ignores malformed JSON without evicting", async () => {
    await listener.callHandle(new TextEncoder().encode("not-json{"));
    expect(evict.mock.calls.length).toBe(0);
  });

  it("ignores schema-mismatched payloads", async () => {
    await listener.callHandle(
      encode({
        tenantId: "550e8400-e29b-41d4-a716-446655440000",
        name: "acme",
        schemaVersion: 99,
      }),
    );
    expect(evict.mock.calls.length).toBe(0);
  });

  it("swallows evictTenant errors so the subscription loop survives", async () => {
    evict.mockImplementation(() => Promise.reject(new Error("boom")));
    await expect(
      listener.callHandle(
        encode({
          schemaVersion: 1,
          tenantId: "550e8400-e29b-41d4-a716-446655440000",
          name: "acme",
        }),
      ),
    ).resolves.toBeUndefined();
    expect(evict.mock.calls.length).toBe(1);
  });
});
