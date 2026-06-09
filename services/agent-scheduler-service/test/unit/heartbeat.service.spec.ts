// services/agent-scheduler-service/test/unit/heartbeat.service.spec.ts
// ── Validation Suite ───────────────────────────────────────────────────────
//
// Full validation for HeartbeatService including tenant tracking, lifecycle
// hooks (start/stop), and heartbeat CloudEvent publishing to NATS JetStream.
// ───────────────────────────────────────────────────────────────────────────

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import type { JetStreamClient } from "nats";

// ── Module Mocks ──────────────────────────────────────────────────────────
// PinoLoggerService is a field initializer in HeartbeatService, not
// constructor-injected, so it must be mocked before the import resolves.
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

import { HeartbeatService } from "../../src/modules/heartbeat/heartbeat.service";

// ── Constants (must match the future implementation) ──────────────────────

const HEARTBEAT_INTERVAL_MS = 15_000;
const TENANT_ACTIVITY_TTL_MS = 5 * 60_000;

// ── Suite ─────────────────────────────────────────────────────────────────

describe("HeartbeatService", () => {
  let service: HeartbeatService;
  let mockJs: { publish: ReturnType<typeof mock> };
  let originalDateNow: typeof Date.now;
  let fakeNow: number;

  // ── Helpers ────────────────────────────────────────────────────────────

  /** Advance the fake clock by the given number of milliseconds. */
  function advanceTime(ms: number): void {
    fakeNow += ms;
  }

  /** Shortcut to access the mock logger attached to the service instance. */
  function logger(): Record<string, ReturnType<typeof mock>> {
    return (service as any).logger;
  }

  // ── Setup / Teardown ───────────────────────────────────────────────────

  beforeEach(() => {
    originalDateNow = Date.now;
    fakeNow = 1_000_000_000_000;
    Date.now = mock(() => fakeNow);

    // Mock JetStreamClient — the future HeartbeatService will accept this
    // via @Inject(JETSTREAM) in its constructor.
    mockJs = { publish: mock(() => Promise.resolve()) };

    // ⚠️  THIS WILL FAIL until HeartbeatService accepts a JetStreamClient
    //     in its constructor (currently it has no explicit constructor).
    //     Expected: TypeError or incorrect instantiation.
    service = new HeartbeatService(mockJs as unknown as JetStreamClient);
  });

  afterEach(() => {
    // ⚠️  THIS WILL FAIL until HeartbeatService implements OnModuleDestroy.
    //     Expected: TypeError: service.onModuleDestroy is not a function.
    try {
      service.onModuleDestroy();
    } catch {
      // swallow during red phase — tests will have already failed above
    }

    Date.now = originalDateNow;
  });

  // ════════════════════════════════════════════════════════════════════════
  //  markTenantActive / getActiveTenants
  // ════════════════════════════════════════════════════════════════════════

  describe("markTenantActive / getActiveTenants", () => {
    it("should register a single tenant as active", () => {
      service.markTenantActive("acme");
      expect(service.getActiveTenants()).toEqual(["acme"]);
    });

    it("should register multiple tenants", () => {
      service.markTenantActive("alpha");
      service.markTenantActive("beta");
      service.markTenantActive("gamma");
      expect(service.getActiveTenants()).toHaveLength(3);
      expect(service.getActiveTenants()).toEqual(
        expect.arrayContaining(["alpha", "beta", "gamma"]),
      );
    });

    it("should refresh the timestamp when marking an already-active tenant", () => {
      service.markTenantActive("tenant-1");
      advanceTime(120_000); // 2 minutes
      service.markTenantActive("tenant-1"); // refresh — stays active for 5 more min
      expect(service.getActiveTenants()).toEqual(["tenant-1"]);
    });

    it("should return an empty array when no tenants are active", () => {
      expect(service.getActiveTenants()).toEqual([]);
    });

    it("should exclude tenants whose last activity exceeds the TTL", () => {
      service.markTenantActive("tenant-1");
      advanceTime(TENANT_ACTIVITY_TTL_MS + 1);
      expect(service.getActiveTenants()).toEqual([]);
    });

    it("should exclude a tenant when last activity exceeds the TTL but keep it alive just under the boundary", () => {
      // The implementation uses strict `<` comparison: `now - lastActivity < TTL`
      service.markTenantActive("boundary");
      advanceTime(TENANT_ACTIVITY_TTL_MS - 1); // 1ms before TTL — still active
      expect(service.getActiveTenants()).toEqual(["boundary"]);

      advanceTime(2); // 1ms past TTL — now excluded
      expect(service.getActiveTenants()).toEqual([]);
    });

    it("should return only active tenants when some have expired", () => {
      service.markTenantActive("old");
      advanceTime(TENANT_ACTIVITY_TTL_MS - 1_000); // 1s before expiry
      service.markTenantActive("recent");
      advanceTime(2_000); // pushes "old" past TTL, "recent" still well within
      expect(service.getActiveTenants()).toEqual(["recent"]);
    });

    it("should purge expired tenants from the internal map on read", () => {
      service.markTenantActive("tenant-1");
      service.markTenantActive("tenant-2");
      advanceTime(TENANT_ACTIVITY_TTL_MS + 1);
      service.getActiveTenants(); // triggers cleanup
      expect((service as any).activeTenants.size).toBe(0);
    });

    it("should handle tenant IDs with special characters", () => {
      service.markTenantActive("tenant/slash");
      service.markTenantActive("tenant space");
      service.markTenantActive("tenant.dot");
      service.markTenantActive("tenant-id_123");
      service.markTenantActive("tenant@special!");
      expect(service.getActiveTenants()).toHaveLength(5);
    });

    it("should handle a large number of active tenants", () => {
      const ids = Array.from({ length: 100 }, (_, i) => `massive-${i}`);
      for (const id of ids) service.markTenantActive(id);
      expect(service.getActiveTenants()).toHaveLength(100);
    });

    it("should extend the active window when re-marking an already-active tenant before expiry", () => {
      service.markTenantActive("extend-me"); // T = 0
      // Advance almost to expiry
      advanceTime(TENANT_ACTIVITY_TTL_MS - 10_000); // T = 4min 50s
      // Re-mark resets the timer to the current fake time
      service.markTenantActive("extend-me"); // timestamp = T = 4min 50s
      // Advance past the original TTL (5 min) but within the new TTL window
      advanceTime(30_000); // T = 5min 20s
      // Without the refresh, tenant would have expired at T = 5min
      // With refresh: now - lastActivity = 5min20s - 4min50s = 30s << 5min
      expect(service.getActiveTenants()).toEqual(["extend-me"]);
    });

    it("should return consistent results across consecutive calls", () => {
      service.markTenantActive("stable-1");
      service.markTenantActive("stable-2");
      const first = service.getActiveTenants();
      const second = service.getActiveTenants();
      expect(first).toEqual(second);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  onModuleInit / onModuleDestroy
  // ════════════════════════════════════════════════════════════════════════

  describe("onModuleInit / onModuleDestroy", () => {
    it("should start the heartbeat interval on init", () => {
      service.onModuleInit();
      expect((service as any).intervalId).not.toBeNull();
    });

    it("should clear the heartbeat interval on destroy", () => {
      service.onModuleInit();
      service.onModuleDestroy();
      expect((service as any).intervalId).toBeNull();
    });

    it("should not throw when destroy is called multiple times", () => {
      service.onModuleInit();
      service.onModuleDestroy();
      expect(() => service.onModuleDestroy()).not.toThrow();
    });

    it("should not throw when destroy is called without a prior init", () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
    });

    it("should be idempotent when stop() is called multiple times", async () => {
      await service.start();
      await service.stop();
      // Second call should not throw and must leave interval cleared
      await service.stop();
      expect((service as any).intervalId).toBeNull();
      expect(service.isRunning()).toBe(false);
    });

    it("should reflect running state through isRunning()", async () => {
      expect(service.isRunning()).toBe(false);
      await service.start();
      expect(service.isRunning()).toBe(true);
      await service.stop();
      expect(service.isRunning()).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  start / stop — edge cases
  // ════════════════════════════════════════════════════════════════════════

  describe("start / stop — edge cases", () => {
    it("should not throw when start() is called while already running", async () => {
      // Note: the current implementation does NOT guard against duplicate
      // intervals — calling start() twice creates a second setInterval.
      // This test only checks that the service remains in a consistent state.
      await service.start();
      // Second call should at minimum not throw
      await expect(service.start()).resolves.toBeUndefined();
      expect(service.isRunning()).toBe(true);
      // Clean up — calling stop() once should be enough to clear the
      // last interval set by start()
      await service.stop();
      expect(service.isRunning()).toBe(false);
      expect((service as any).intervalId).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  publishHeartbeats (private method — invoked via (service as any))
  // ════════════════════════════════════════════════════════════════════════

  describe("publishHeartbeats", () => {
    it("should publish a message for each active tenant", async () => {
      service.markTenantActive("t1");
      service.markTenantActive("t2");
      service.markTenantActive("t3");
      await (service as any).publishHeartbeats();
      expect(mockJs.publish).toHaveBeenCalledTimes(3);
    });

    it("should publish using the correct NATS subject format", async () => {
      service.markTenantActive("my-tenant");
      await (service as any).publishHeartbeats();
      const [subject] = mockJs.publish.mock.calls[0];
      expect(subject).toBe(
        "evt.my-tenant.agent-scheduler-service.automation.platform.internal.heartbeat.v1",
      );
    });

    it("should include all required CloudEvent envelope fields", async () => {
      service.markTenantActive("t1");
      await (service as any).publishHeartbeats();
      const [, raw] = mockJs.publish.mock.calls[0];
      const env = JSON.parse(raw as string);

      expect(env.specversion).toBe("1.0");
      expect(env.type).toBe("io.yoizen.platform.scheduler.heartbeat.v1");
      expect(env.source).toBe("agent-scheduler-service");
      expect(env.resource).toBe("agent-scheduler-service/heartbeat");
      expect(env.producer).toBe("agent-scheduler-service");
      expect(env.domain).toBe("automation");
      expect(env.channel).toBe("platform");
      expect(env.provider).toBe("internal");
      expect(env.transport).toEqual({ name: "nats", version: "1.0" });
    });

    it("should generate id, correlation_id, idempotencykey, and time per batch", async () => {
      service.markTenantActive("t1");
      await (service as any).publishHeartbeats();
      const [, raw] = mockJs.publish.mock.calls[0];
      const env = JSON.parse(raw as string);

      expect(env).toHaveProperty("id");
      expect(typeof env.id).toBe("string");
      expect(env).toHaveProperty("correlation_id");
      expect(typeof env.correlation_id).toBe("string");
      expect(env).toHaveProperty("idempotencykey");
      expect(typeof env.idempotencykey).toBe("string");
      expect(env).toHaveProperty("time");
      expect(typeof env.time).toBe("string");
    });

    it("should set the tenant-specific subject and tenant field per message", async () => {
      service.markTenantActive("alpha");
      service.markTenantActive("beta");
      await (service as any).publishHeartbeats();

      const subjects = mockJs.publish.mock.calls.map((c: any[]) => c[0]);
      expect(subjects[0]).toContain("alpha");
      expect(subjects[1]).toContain("beta");

      const payloads = mockJs.publish.mock.calls.map(
        (c: any[]) => JSON.parse(c[1] as string),
      );
      expect(payloads[0].tenant).toBe("alpha");
      expect(payloads[1].tenant).toBe("beta");
    });

    it("should assign a unique id to every published message", async () => {
      service.markTenantActive("a");
      service.markTenantActive("b");
      await (service as any).publishHeartbeats();

      const ids = mockJs.publish.mock.calls.map(
        (c: any[]) => JSON.parse(c[1] as string).id,
      );
      expect(ids[0]).not.toBe(ids[1]);
    });

    it("should include the active tenant count in the data payload", async () => {
      service.markTenantActive("x");
      service.markTenantActive("y");
      await (service as any).publishHeartbeats();

      const [, raw] = mockJs.publish.mock.calls[0];
      const env = JSON.parse(raw as string);

      expect(env.data.payload.activeTenants).toBe(2);
      expect(env.data.payload.status).toBe("online");
      expect(env.data.payload.service).toBe("agent-scheduler-service");
      expect(env.data.payload).toHaveProperty("timestamp");
    });

    it("should not publish anything when there are no active tenants", async () => {
      await (service as any).publishHeartbeats();
      expect(mockJs.publish).not.toHaveBeenCalled();
    });

    it("should continue to the next tenant when publish throws for one tenant", async () => {
      let callCount = 0;
      mockJs.publish = mock(() => {
        callCount++;
        if (callCount === 1 || callCount === 3) {
          return Promise.reject(new Error("NATS unavailable"));
        }
        return Promise.resolve();
      });

      service.markTenantActive("fail-1");
      service.markTenantActive("ok-1");
      service.markTenantActive("fail-2");
      service.markTenantActive("ok-2");

      await (service as any).publishHeartbeats();

      // All four tenants should have been attempted
      expect(mockJs.publish).toHaveBeenCalledTimes(4);
      // Warnings for the two failing tenants
      expect(logger().warn).toHaveBeenCalledTimes(2);
    });

    it("should log a warning with the tenant ID and error message on failure", async () => {
      mockJs.publish = mock(() => {
        return Promise.reject(new Error("Connection lost"));
      });

      service.markTenantActive("failing-tenant");
      await (service as any).publishHeartbeats();

      expect(logger().warn).toHaveBeenCalledTimes(1);
      const warningMessage = (logger().warn.mock.calls[0] as [string])[0];
      expect(warningMessage).toContain("failing-tenant");
      expect(warningMessage).toContain("Connection lost");
    });

    it("should produce a complete CloudEvent envelope with all expected fields", async () => {
      service.markTenantActive("full-envelope");
      await (service as any).publishHeartbeats();

      const [, raw] = mockJs.publish.mock.calls[0];
      const env = JSON.parse(raw as string);

      // CloudEvent required attributes
      expect(env.specversion).toBe("1.0");
      expect(env.id).toBeString();
      expect(env.type).toBe("io.yoizen.platform.scheduler.heartbeat.v1");
      expect(env.source).toBe("agent-scheduler-service");
      expect(env.time).toBeString();

      // Yoizen platform envelope fields
      expect(env.resource).toBe("agent-scheduler-service/heartbeat");
      expect(env.correlation_id).toBeString();
      expect(env.idempotencykey).toBeString();
      expect(env.tenant).toBe("full-envelope");
      expect(env.producer).toBe("agent-scheduler-service");
      expect(env.domain).toBe("automation");
      expect(env.channel).toBe("platform");
      expect(env.provider).toBe("internal");
      expect(env.transport).toEqual({ name: "nats", version: "1.0" });

      // Data payload
      expect(env.data).toBeDefined();
      expect(env.data.payload.activeTenants).toBe(1);
      expect(env.data.payload.status).toBe("online");
      expect(env.data.payload.service).toBe("agent-scheduler-service");
      expect(env.data.payload.timestamp).toBeString();

      // No unexpected top-level fields
      const allowedKeys = [
        "specversion", "id", "type", "source", "time",
        "resource", "correlation_id", "idempotencykey",
        "tenant", "producer", "domain", "channel",
        "provider", "transport", "data",
      ];
      expect(Object.keys(env).sort()).toEqual(allowedKeys.sort());
    });
  });
});
