import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
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

    mockJs = { publish: mock(() => Promise.resolve()) };

    // Instantiate directly — the @Inject(JETSTREAM) decorator sets runtime
    // metadata but does not interfere with plain instantiation.
    service = new HeartbeatService(mockJs as unknown as JetStreamClient);
  });

  afterEach(() => {
    service.onModuleDestroy();

    // Restore the real Date.now so other tests are not affected
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
        expect.arrayContaining(["alpha", "beta", "gamma"])
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
      for (const id of ids) {
        service.markTenantActive(id);
      }
      expect(service.getActiveTenants()).toHaveLength(100);
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

    // WIRE CHANGE 2026-08-07 (PENDIENTES/04-e3-subject.spec.md / E3, closing
    // DRIFT.md item 10): token 2 is the producer routing key and this service
    // is the producer — the subject said `ai-agent-gateway` while the envelope
    // below already said `agent-ai-service`.
    it("should publish using the correct NATS subject format", async () => {
      service.markTenantActive("my-tenant");
      await (service as any).publishHeartbeats();
      const [subject] = mockJs.publish.mock.calls[0];
      expect(subject).toBe(
        "evt.my-tenant.agent-ai-service.automation.platform.internal.online.v1"
      );
    });

    it("names the same producer on the subject and in the envelope", async () => {
      service.markTenantActive("my-tenant");
      await (service as any).publishHeartbeats();
      const [subject, raw] = mockJs.publish.mock.calls[0];
      const env = JSON.parse(raw as string);

      expect((subject as string).split(".")[2]).toBe(env.producer);
      expect(env.producer).toBe("agent-ai-service");
    });

    it("should include all required CloudEvent envelope fields", async () => {
      service.markTenantActive("t1");
      await (service as any).publishHeartbeats();
      const [, raw] = mockJs.publish.mock.calls[0];
      const env = JSON.parse(raw as string);

      expect(env.specversion).toBe("1.0");
      expect(env.type).toBe("io.yoizen.platform.runtime.online.v1");
      expect(env.source).toBe("agent-ai-service/heartbeat");
      expect(env.resource).toBe("agent-ai-service/heartbeat");
      expect(env.producer).toBe("agent-ai-service");
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

      const payloads = mockJs.publish.mock.calls.map((c: any[]) =>
        JSON.parse(c[1] as string)
      );
      expect(payloads[0].tenant).toBe("alpha");
      expect(payloads[1].tenant).toBe("beta");
    });

    it("should assign a unique id to every published message", async () => {
      service.markTenantActive("a");
      service.markTenantActive("b");
      await (service as any).publishHeartbeats();

      const ids = mockJs.publish.mock.calls.map(
        (c: any[]) => JSON.parse(c[1] as string).id
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
      expect(env.data.payload.service).toBe("agent-ai-service");
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
          throw new Error("NATS unavailable");
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
        throw new Error("Connection lost");
      });

      service.markTenantActive("failing-tenant");
      await (service as any).publishHeartbeats();

      expect(logger().warn).toHaveBeenCalledTimes(1);
      const warningMessage = (logger().warn.mock.calls[0] as [string])[0];
      expect(warningMessage).toContain("failing-tenant");
      expect(warningMessage).toContain("Connection lost");
    });
  });
});
