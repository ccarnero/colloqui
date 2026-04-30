import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { TenantReadySchemaListener } from "../../src/tenant-ready-schema-listener";
import type { TenantConnectionManager } from "../../src/tenant-connection-manager";
import type { NatsConnection } from "nats";

/**
 * Tests target the protected `handle()` seam directly so we don't need
 * a live NATS subscription. Mirror of `TenantDeletionEvictionListener`'s
 * spec: the harness exposes the protected method publicly so each
 * branch (happy path, missing/invalid payloads, ensureSchema rejection)
 * can be exercised without spinning up a broker.
 */
class HarnessListener extends TenantReadySchemaListener {
  public callHandle(payload: Uint8Array): Promise<void> {
    // biome-ignore lint/complexity/useLiteralKeys: protected access for test
    return (this as unknown as { handle: (p: Uint8Array) => Promise<void> }).handle(
      payload,
    );
  }
}

interface IFakeManager {
  ensureSchema: ReturnType<typeof mock>;
}

function buildHarness(): {
  listener: HarnessListener;
  ensureSchema: ReturnType<typeof mock>;
} {
  const ensureSchema = mock(() => Promise.resolve(undefined));
  const fakeManager: IFakeManager = { ensureSchema };
  const fakeNc: Pick<NatsConnection, "subscribe"> = {
    subscribe: () => {
      throw new Error("subscribe should not be called in unit tests");
    },
  };
  const listener = new HarnessListener(
    fakeNc as NatsConnection,
    fakeManager as unknown as TenantConnectionManager,
  );
  return { listener, ensureSchema };
}

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

describe("TenantReadySchemaListener.handle", () => {
  let ensureSchema: ReturnType<typeof mock>;
  let listener: HarnessListener;

  beforeEach(() => {
    const built = buildHarness();
    ensureSchema = built.ensureSchema;
    listener = built.listener;
  });

  afterEach(() => {
    ensureSchema.mockReset();
  });

  it("calls ensureSchema with the tenant NAME for a v1 ready message", async () => {
    await listener.callHandle(
      encode({
        schemaVersion: 1,
        tenantId: "tid-1",
        name: "acme",
      }),
    );
    // ensureSchema is keyed on tenant name (the catalog/pool key), not id.
    expect(ensureSchema.mock.calls).toEqual([["acme"]]);
  });

  it("warms schema when optional tier metadata is provided", async () => {
    await listener.callHandle(
      encode({
        schemaVersion: 1,
        tenantId: "tid-1",
        name: "acme",
        tier: "shared",
      }),
    );
    expect(ensureSchema.mock.calls).toEqual([["acme"]]);
  });

  it("rejects v1 payload with an unknown tier value", async () => {
    await listener.callHandle(
      encode({
        schemaVersion: 1,
        tenantId: "tid-1",
        name: "acme",
        tier: "platinum",
      }),
    );
    expect(ensureSchema.mock.calls.length).toBe(0);
  });

  it("ignores non-JSON payloads without throwing or warming", async () => {
    const garbage = new TextEncoder().encode("not-json{");
    await listener.callHandle(garbage);
    expect(ensureSchema.mock.calls.length).toBe(0);
  });

  it("ignores payloads that don't match the v1 schema", async () => {
    await listener.callHandle(
      encode({ schemaVersion: 2, tenantId: "acme", name: "acme" }),
    );
    await listener.callHandle(
      encode({ schemaVersion: 1, tenantId: "", name: "acme" }),
    );
    await listener.callHandle(
      encode({ schemaVersion: 1, tenantId: "acme" }),
    );
    expect(ensureSchema.mock.calls.length).toBe(0);
  });

  it("swallows ensureSchema errors so a flaky migration can't kill the subscription loop", async () => {
    ensureSchema.mockImplementation(() =>
      Promise.reject(new Error("DDL boom")),
    );
    await expect(
      listener.callHandle(
        encode({ schemaVersion: 1, tenantId: "tid-1", name: "acme" }),
      ),
    ).resolves.toBeUndefined();
    expect(ensureSchema.mock.calls.length).toBe(1);
  });
});
