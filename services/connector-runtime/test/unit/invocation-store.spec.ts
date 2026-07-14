import { beforeEach, describe, expect, it, mock } from "bun:test";

// In-memory fake Redis with real TTL-expiry semantics (ms-based, tests use
// short TTLs + tiny sleeps) so the T05 "TTL expiry" acceptance criterion is
// exercised against actual expiry logic, not a stub that always returns a
// value.
interface FakeEntry {
  readonly value: string;
  readonly expiresAt: number;
}
const store = new Map<string, FakeEntry>();

const fakeRedisInstance = {
  set: mock(
    async (key: string, value: string, _ex: string, ttlSeconds: number) => {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return "OK";
    }
  ),
  get: mock(async (key: string) => {
    const entry = store.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() >= entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }),
};

mock.module("ioredis", () => ({
  default: class Redis {
    constructor() {
      return fakeRedisInstance;
    }
  },
}));

mock.module("@yoizen/observability", () => ({
  tracedFetch: () => Promise.resolve(new Response("{}", { status: 200 })),
  getMeter: () => ({
    createCounter: () => ({ add() {} }),
    createHistogram: () => ({ record() {} }),
  }),
  startNatsProducerSpan: () => ({ span: { end() {} } }),
  startNatsConsumerSpan: () => ({ span: { end() {} } }),
  injectTraceContext: () => {},
  activeOrRandomTraceId: () => "trace-1",
  logWithEnvelope: () => {},
  createCircuitBreakerMetrics: () => ({
    recordDecision() {},
    recordTransition() {},
    recordL1Hit() {},
    recordRedisError() {},
    recordDecideDuration() {},
  }),
  PinoLoggerService: class FakeLogger {
    log() {}
    warn() {}
    error() {}
  },
}));

const { parkInvocationResult, getInvocationRecord } = await import(
  "../../src/activities/_shared/invocation-store"
);

describe("invocation-store (Redis-backed)", () => {
  beforeEach(() => {
    store.clear();
  });

  it("parks and reads back a pending record", async () => {
    await parkInvocationResult(
      {
        status: "pending",
        tenantId: "acme",
        invocationId: "inv-1",
        acceptedAt: "2026-07-14T00:00:00.000Z",
      },
      60
    );
    const record = await getInvocationRecord("acme", "inv-1");
    expect(record).toMatchObject({ status: "pending", invocationId: "inv-1" });
  });

  it("overwrites the pending record with the completed one at the SAME key (idempotent, no duplicate)", async () => {
    await parkInvocationResult(
      {
        status: "pending",
        tenantId: "acme",
        invocationId: "inv-1",
        acceptedAt: "t",
      },
      60
    );
    await parkInvocationResult(
      {
        status: "completed",
        tenantId: "acme",
        invocationId: "inv-1",
        completedAt: "t2",
        outcome: "ok",
        result: { status: 200, data: {}, headers: {} },
      },
      60
    );
    expect(store.size).toBe(1);
    const record = await getInvocationRecord("acme", "inv-1");
    expect(record).toMatchObject({ status: "completed", outcome: "ok" });
  });

  it("redelivery: parking the same completed record twice does not create a second entry", async () => {
    const completed = {
      status: "completed" as const,
      tenantId: "acme",
      invocationId: "inv-1",
      completedAt: "t",
      outcome: "ok" as const,
      result: { status: 200, data: {}, headers: {} },
    };
    await parkInvocationResult(completed, 60);
    await parkInvocationResult(completed, 60);
    expect(store.size).toBe(1);
  });

  it("returns null (expired) once the TTL elapses", async () => {
    // Deterministic TTL-expiry simulation: Redis's own TTL enforcement is
    // well-tested library behavior, not this module's responsibility — what
    // THIS module must get right is treating a post-expiry cache-miss as
    // `null`. A real wall-clock sleep here previously caused intermittent
    // cross-file `bun test` process instability (a stray `net` timer racing
    // the test runner's own teardown — see git history), so this test
    // fast-forwards the fake store's clock instead of sleeping.
    await parkInvocationResult(
      {
        status: "completed",
        tenantId: "acme",
        invocationId: "inv-1",
        completedAt: "t",
        outcome: "ok",
        result: { status: 200, data: {}, headers: {} },
      },
      60
    );
    const key = "invocation:acme:inv-1";
    const entry = store.get(key);
    expect(entry).toBeDefined();
    // Force the fake entry into the past — equivalent to "TTL has elapsed".
    store.set(key, { value: entry!.value, expiresAt: Date.now() - 1 });

    const record = await getInvocationRecord("acme", "inv-1");
    expect(record).toBeNull();
  });

  it("scopes reads by tenant (cross-tenant isolation)", async () => {
    await parkInvocationResult(
      {
        status: "completed",
        tenantId: "acme",
        invocationId: "inv-1",
        completedAt: "t",
        outcome: "ok",
        result: { status: 200, data: {}, headers: {} },
      },
      60
    );
    const crossTenantRead = await getInvocationRecord("globex", "inv-1");
    expect(crossTenantRead).toBeNull();
  });
});
