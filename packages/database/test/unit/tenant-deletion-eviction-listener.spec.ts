import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { TenantDeletionEvictionListener } from "../../src/tenant-deletion-eviction-listener";
import type { TenantConnectionManager } from "../../src/tenant-connection-manager";
import type { NatsConnection } from "nats";

/**
 * Tests target the protected `handle()` seam directly so we don't need
 * a live NATS subscription. The class is publicly exposed as a typed
 * interface — we exercise it through a small subclass that surfaces
 * `handle()` as a public method. This keeps the production constructor
 * signature unchanged while letting us assert all branches deterministically.
 */
class HarnessListener extends TenantDeletionEvictionListener {
  public callHandle(payload: Uint8Array): Promise<void> {
    // biome-ignore lint/complexity/useLiteralKeys: protected access for test
    return (this as unknown as { handle: (p: Uint8Array) => Promise<void> }).handle(
      payload,
    );
  }
}

interface IFakeManager {
  evictTenant: ReturnType<typeof mock>;
}

function buildHarness(): {
  listener: HarnessListener;
  evict: ReturnType<typeof mock>;
} {
  const evict = mock(() => Promise.resolve());
  const fakeManager: IFakeManager = { evictTenant: evict };
  const fakeNc: Pick<NatsConnection, "subscribe"> = {
    subscribe: () => {
      throw new Error("subscribe should not be called in unit tests");
    },
  };
  const listener = new HarnessListener(
    fakeNc as NatsConnection,
    fakeManager as unknown as TenantConnectionManager,
  );
  return { listener, evict };
}

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

describe("TenantDeletionEvictionListener.handle", () => {
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

  it("evicts pools for a v1 deletion message with required fields", async () => {
    // Use a distinct platform UUID for `tenantId` and slug for `name` so the
    // test exercises the actual production wire format (the publisher sets
    // `tenantId = row.id`, `name = row.name`). The earlier version of this
    // spec used `tenantId === name`, which masked a real bug where the
    // listener forwarded the UUID into `evictTenant` even though every
    // cache inside `TenantConnectionManager` is keyed by the slug.
    await listener.callHandle(
      encode({
        schemaVersion: 1,
        tenantId: "550e8400-e29b-41d4-a716-446655440000",
        name: "acme",
      }),
    );
    expect(evict.mock.calls).toEqual([["acme"]]);
  });

  it("evicts when optional tier metadata is provided", async () => {
    await listener.callHandle(
      encode({
        schemaVersion: 1,
        tenantId: "550e8400-e29b-41d4-a716-446655440000",
        name: "acme",
        tier: "shared",
      }),
    );
    expect(evict.mock.calls).toEqual([["acme"]]);
  });

  it("ignores non-JSON payloads without throwing or evicting", async () => {
    const garbage = new TextEncoder().encode("not-json{");
    await listener.callHandle(garbage);
    expect(evict.mock.calls.length).toBe(0);
  });

  it("ignores payloads that don't match the v1 schema", async () => {
    await listener.callHandle(
      encode({
        schemaVersion: 2,
        tenantId: "550e8400-e29b-41d4-a716-446655440000",
        name: "acme",
      }),
    );
    await listener.callHandle(
      encode({ schemaVersion: 1, tenantId: "", name: "acme" }),
    );
    await listener.callHandle(
      encode({
        schemaVersion: 1,
        tenantId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    );
    expect(evict.mock.calls.length).toBe(0);
  });

  it("swallows evictTenant errors so a flaky pool can't kill the subscription loop", async () => {
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
