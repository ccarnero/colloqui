import "reflect-metadata";
import { describe, it, expect, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Mock @yoizen/observability BEFORE any module imports it.
// The DepthTrackerService creates PinoLoggerService directly in a field
// initializer (not via Nest DI), so the mock MUST be in place at module load
// time to avoid pulling in real pino and OpenTelemetry dependencies.
// ---------------------------------------------------------------------------
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockPinoLoggerService {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
    verbose = mock(() => {});
    fatal = mock(() => {});
  },
}));

import { Test } from "@nestjs/testing";
import {
  DepthTrackerService,
  DepthExceededError,
} from "../../src/modules/depth-tracker/depth-tracker.service";

// ---------------------------------------------------------------------------
// Helper: call enforceDepthLimit and return the error if it throws.
// Keeps assertions clean by avoiding try/catch in every test.
// ---------------------------------------------------------------------------
function catchEnforceDepthLimit(
  service: DepthTrackerService,
  envelope: Record<string, unknown>,
  maxDepth?: number,
): unknown {
  try {
    service.enforceDepthLimit(envelope, maxDepth);
    return null;
  } catch (err) {
    return err;
  }
}

describe("DepthTrackerService", () => {
  let service: DepthTrackerService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [DepthTrackerService],
    }).compile();
    service = moduleRef.get(DepthTrackerService);
  });

  // =========================================================================
  //  enforceDepthLimit
  // =========================================================================
  describe("enforceDepthLimit", () => {
    // ── happy path ─────────────────────────────────────────────────────────

    it("should not throw when depth is below max (depth=3)", () => {
      expect(() =>
        service.enforceDepthLimit({ transport: { depth: 3 } }),
      ).not.toThrow();
    });

    it("should not throw when depth is zero", () => {
      expect(() =>
        service.enforceDepthLimit({ transport: { depth: 0 } }),
      ).not.toThrow();
    });

    it("should not throw when depth is negative", () => {
      expect(() =>
        service.enforceDepthLimit({ transport: { depth: -1 } }),
      ).not.toThrow();
    });

    it("should not throw when depth is -Infinity", () => {
      expect(() =>
        service.enforceDepthLimit({ transport: { depth: -Infinity } }),
      ).not.toThrow();
    });

    // ── missing / partial transport ───────────────────────────────────────

    it("should not throw when envelope has no transport field", () => {
      expect(() => service.enforceDepthLimit({})).not.toThrow();
    });

    it("should not throw when transport object has no depth property", () => {
      expect(() =>
        service.enforceDepthLimit({ transport: {} }),
      ).not.toThrow();
    });

    it("should not throw when transport is null", () => {
      expect(() =>
        service.enforceDepthLimit({ transport: null }),
      ).not.toThrow();
    });

    it("should not throw when transport is undefined", () => {
      expect(() =>
        service.enforceDepthLimit({ transport: undefined }),
      ).not.toThrow();
    });

    it("should not throw when depth is a non-numeric string (NaN >= 5 is false)", () => {
      // The "as number" cast is a TS type-assertion only; at runtime the
      // value stays "abc".  NaN >= 5 is false, so it falls through safely.
      expect(() =>
        service.enforceDepthLimit({ transport: { depth: "abc" } }),
      ).not.toThrow();
    });

    // ── boundary: at max depth (≥ triggers) ──────────────────────────────

    it("should throw when depth equals the default max (depth=5)", () => {
      const err = catchEnforceDepthLimit(service, {
        transport: { depth: 5 },
      });
      expect(err).toBeInstanceOf(DepthExceededError);
    });

    it("should throw when depth exceeds default max (depth=6)", () => {
      const err = catchEnforceDepthLimit(service, {
        transport: { depth: 6 },
      });
      expect(err).toBeInstanceOf(DepthExceededError);
    });

    it("should throw for very large depth (depth=99)", () => {
      const err = catchEnforceDepthLimit(service, {
        transport: { depth: 99 },
      });
      expect(err).toBeInstanceOf(DepthExceededError);
    });

    it("should throw when depth is exactly a custom maxDepth", () => {
      const err = catchEnforceDepthLimit(
        service,
        { transport: { depth: 3 } },
        3,
      );
      expect(err).toBeInstanceOf(DepthExceededError);
    });

    it("should throw when depth exceeds a custom maxDepth", () => {
      const err = catchEnforceDepthLimit(
        service,
        { transport: { depth: 5 } },
        3,
      );
      expect(err).toBeInstanceOf(DepthExceededError);
    });

    // ── custom maxDepth — below threshold ─────────────────────────────────

    it("should pass when depth is below a custom maxDepth (depth=3, max=10)", () => {
      expect(() =>
        service.enforceDepthLimit({ transport: { depth: 3 } }, 10),
      ).not.toThrow();
    });

    it("should pass when depth equals a custom maxDepth of 1 and depth is 0", () => {
      expect(() =>
        service.enforceDepthLimit({ transport: { depth: 0 } }, 1),
      ).not.toThrow();
    });

    // ── error shape ──────────────────────────────────────────────────────

    it("should throw an instance of DepthExceededError", () => {
      const err = catchEnforceDepthLimit(service, {
        transport: { depth: 6 },
      });
      expect(err).toBeInstanceOf(DepthExceededError);
      expect((err as DepthExceededError).name).toBe("DepthExceededError");
    });

    it("should include depth, maxDepth, and tenant in the error", () => {
      const err = catchEnforceDepthLimit(service, {
        transport: { depth: 7 },
        tenant: "acme-corp",
      }) as DepthExceededError;

      expect(err.depth).toBe(7);
      expect(err.maxDepth).toBe(5);
      expect(err.tenant).toBe("acme-corp");
    });

    it("should format the error message with depth, maxDepth, and tenant", () => {
      const err = catchEnforceDepthLimit(service, {
        transport: { depth: 8 },
        tenant: "test-tenant",
      }) as DepthExceededError;

      expect(err.message).toContain("8");
      expect(err.message).toContain("5");
      expect(err.message).toContain("test-tenant");
      expect(err.message).toBe(
        "[depth-tracker] depth=8 >= MAX_DEPTH=5 (tenant=test-tenant)",
      );
    });

    it("should default tenant to 'unknown' when not provided", () => {
      const err = catchEnforceDepthLimit(service, {
        transport: { depth: 9 },
      }) as DepthExceededError;

      expect(err.tenant).toBe("unknown");
      expect(err.message).toContain("unknown");
    });

    it("should use the custom maxDepth in the error object", () => {
      const err = catchEnforceDepthLimit(
        service,
        { transport: { depth: 7 }, tenant: "t" },
        3,
      ) as DepthExceededError;

      expect(err.depth).toBe(7);
      expect(err.maxDepth).toBe(3);
      expect(err.message).toBe("[depth-tracker] depth=7 >= MAX_DEPTH=3 (tenant=t)");
    });

    it("should coerce depth of 5 with custom maxDepth=5 into throwing", () => {
      const err = catchEnforceDepthLimit(
        service,
        { transport: { depth: 5 } },
        5,
      );
      expect(err).toBeInstanceOf(DepthExceededError);
    });
  });

  // =========================================================================
  //  incrementDepth
  // =========================================================================
  describe("incrementDepth", () => {
    // ── depth initialisation ───────────────────────────────────────────────

    it("should set depth to 1 when no transport exists", () => {
      const result = service.incrementDepth({});
      expect(result.transport).toBeDefined();
      expect((result.transport as Record<string, unknown>).depth).toBe(1);
    });

    it("should set depth to 1 when transport has no depth", () => {
      const result = service.incrementDepth({ transport: {} });
      expect((result.transport as Record<string, unknown>).depth).toBe(1);
    });

    it("should set depth to 1 when transport is null", () => {
      const result = service.incrementDepth({ transport: null });
      expect((result.transport as Record<string, unknown>).depth).toBe(1);
    });

    it("should set depth to 1 when transport is undefined", () => {
      const result = service.incrementDepth({ transport: undefined });
      expect((result.transport as Record<string, unknown>).depth).toBe(1);
    });

    // ── incrementing ───────────────────────────────────────────────────────

    it("should increment existing depth from 3 to 4", () => {
      const result = service.incrementDepth({
        transport: { depth: 3 },
      });
      expect((result.transport as Record<string, unknown>).depth).toBe(4);
    });

    it("should increment existing depth from 0 to 1", () => {
      const result = service.incrementDepth({
        transport: { depth: 0 },
      });
      expect((result.transport as Record<string, unknown>).depth).toBe(1);
    });

    it("should increment existing depth from 5 to 6", () => {
      const result = service.incrementDepth({
        transport: { depth: 5 },
      });
      expect((result.transport as Record<string, unknown>).depth).toBe(6);
    });

    // ── preservation of other data ─────────────────────────────────────────

    it("should preserve other envelope fields", () => {
      const result = service.incrementDepth({
        id: "abc-123",
        type: "agent:response",
      });
      expect(result).toHaveProperty("id", "abc-123");
      expect(result).toHaveProperty("type", "agent:response");
    });

    it("should preserve other transport fields", () => {
      const result = service.incrementDepth({
        transport: { gateway: "http", version: "1.0", depth: 2 },
      });
      const t = result.transport as Record<string, unknown>;
      expect(t).toHaveProperty("gateway", "http");
      expect(t).toHaveProperty("version", "1.0");
      expect(t.depth).toBe(3);
    });

    // ── causation_id ───────────────────────────────────────────────────────

    it("should set causation_id from envelope id when present", () => {
      const result = service.incrementDepth({ id: "evt-001" });
      expect(result).toHaveProperty("causation_id", "evt-001");
    });

    it("should set causation_id to null when envelope has no id", () => {
      const result = service.incrementDepth({});
      expect(result).toHaveProperty("causation_id", null);
    });

    it("should set causation_id to null when id is undefined", () => {
      const result = service.incrementDepth({ id: undefined });
      expect(result).toHaveProperty("causation_id", null);
    });

    // ── immutability ───────────────────────────────────────────────────────

    it("should not mutate the original envelope", () => {
      const original = { transport: { depth: 2 }, id: "orig-1" };
      const originalTransport = original.transport;

      const _result = service.incrementDepth(original);

      expect(original.transport.depth).toBe(2);
      expect(original).not.toHaveProperty("causation_id");
    });

    it("should return a new object reference", () => {
      const original = { transport: { depth: 1 } };
      const result = service.incrementDepth(original);
      expect(result).not.toBe(original);
    });
  });
});
