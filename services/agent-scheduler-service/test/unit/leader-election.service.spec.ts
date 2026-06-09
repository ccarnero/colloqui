// ── Validation Suite ─────────────────────────────────────────────────────────
// Full validation for LeaderElectionService including pg_advisory lock
// acquisition, renewal, release (pg_advisory_unlock), lifecycle hooks, and
// error handling.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Reconstruct the full SQL string from a tagged-template call.
 * A tagged-template invocation produces arguments of the form:
 *   [strings: TemplateStringsArray, ...values: unknown[]]
 */
function reconstructSql(callArgs: unknown[]): string {
  const [strings, ...values] = callArgs as [string[], ...unknown[]];
  let sql = "";
  for (let i = 0; i < strings.length; i++) {
    sql += strings[i];
    if (i < values.length) {
      sql += String(values[i]);
    }
  }
  return sql;
}

// ── Module Mocks ───────────────────────────────────────────────────────────

// Mock Sql instance — shared across all tests.  Each test clears call history
// and can optionally override the implementation for a specific scenario.
const mockSqlEnd = mock(() => Promise.resolve());
const mockSql = Object.assign(
  mock((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sqlText = reconstructSql([strings, ...values]);
    if (sqlText.includes("pg_advisory_unlock")) {
      return Promise.resolve([{ pg_advisory_unlock: 1 }]);
    }
    return Promise.resolve([{ acquired: true, still_mine: true }]);
  }),
  { end: mockSqlEnd },
);

// Mock the `postgres` library default export so that `postgres(url)` returns
// our shared mockSql instance.
mock.module("postgres", () => ({
  default: mock(() => mockSql),
}));

// Mock observability — PinoLoggerService is a field initializer
// (not DI-injected), so it must be mocked before the service import resolves.
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

import { LeaderElectionService } from "../../src/modules/scheduler/leader-election.service";

const TEST_PG_URL = "postgres://test:test@localhost:5432/test";

// ── Suite ──────────────────────────────────────────────────────────────────

describe("LeaderElectionService", () => {
  let service: LeaderElectionService;

  // Captured renewal callback from the mocked setInterval.
  // The production `startRenewal()` sets an interval whose callback we capture
  // here so tests can invoke it synchronously.
  let capturedRenewalFn: (() => Promise<void>) | null;
  let originalSetInterval: typeof globalThis.setInterval;

  // ── Default mock implementation ──────────────────────────────────────────

  /** Reset mockSql to the default success behaviour. */
  function resetMockSql(): void {
    mockSql.mockClear();
    mockSqlEnd.mockClear();
    mockSql.mockImplementation(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sqlText = reconstructSql([strings, ...values]);
        if (sqlText.includes("pg_advisory_unlock")) {
          return Promise.resolve([{ pg_advisory_unlock: 1 }]);
        }
        return Promise.resolve([{ acquired: true, still_mine: true }]);
      },
    );
  }

  // ── Setup / Teardown ────────────────────────────────────────────────────

  beforeEach(() => {
    capturedRenewalFn = null;
    originalSetInterval = globalThis.setInterval;

    // Mock setInterval to capture the renewal callback so tests can drive it.
    globalThis.setInterval = ((
      fn: (...args: unknown[]) => void,
      _ms: number,
    ) => {
      capturedRenewalFn = fn as unknown as () => Promise<void>;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof globalThis.setInterval;

    resetMockSql();

    service = new LeaderElectionService();
  });

  afterEach(() => {
    // Restore native setInterval
    globalThis.setInterval = originalSetInterval;

    // Tear down any dangling interval on the service instance
    if ((service as Record<string, unknown>).renewalInterval) {
      clearInterval(
        (service as Record<string, unknown>).renewalInterval as NodeJS.Timeout,
      );
    }

    // Restore default mock implementation for the next test
    resetMockSql();
  });

  // ════════════════════════════════════════════════════════════════════════
  //  release
  // ════════════════════════════════════════════════════════════════════════

  describe("release", () => {
    it("should exist as a method on the service instance", () => {
      expect(service.release).toBeDefined();
    });

    it("should call pg_advisory_unlock with the advisory lock ID 32767", async () => {
      // Arrange
      await service.tryAcquireLeadership(TEST_PG_URL);
      mockSql.mockClear();

      // Act
      await service.release();

      // Assert
      expect(mockSql).toHaveBeenCalledTimes(1);
      const sql = reconstructSql(mockSql.mock.calls[0] as unknown[]);
      expect(sql).toContain("pg_advisory_unlock");
      expect(sql).toContain("32767");
    });

    it("should call end() on the postgres connection after releasing the lock", async () => {
      // Arrange
      await service.tryAcquireLeadership(TEST_PG_URL);
      mockSql.mockClear();
      mockSqlEnd.mockClear();

      // Act
      await service.release();

      // Assert — connection must be closed after explicit unlock
      expect(mockSqlEnd).toHaveBeenCalledTimes(1);
    });

    it("should be idempotent when release() is called twice", async () => {
      // Arrange
      await service.tryAcquireLeadership(TEST_PG_URL);
      // First release — acquires the lock, closes the connection
      await service.release();
      mockSql.mockClear();
      mockSqlEnd.mockClear();

      // Act — second release
      await service.release();

      // Assert — no additional SQL calls, no connection close
      expect(mockSql).not.toHaveBeenCalled();
      expect(mockSqlEnd).not.toHaveBeenCalled();
      expect((service as Record<string, unknown>).platformSql).toBeNull();
    });

    it("should not throw when release() is called without a prior connection", async () => {
      // Arrange — no tryAcquireLeadership call
      // Act & Assert
      await expect(service.release()).resolves.toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  release — error handling
  // ════════════════════════════════════════════════════════════════════════

  describe("release — error handling", () => {
    it("should handle SQL errors during pg_advisory_unlock without throwing", async () => {
      // Arrange
      await service.tryAcquireLeadership(TEST_PG_URL);
      mockSql.mockClear();
      mockSqlEnd.mockClear();

      // Make the advisory unlock query throw
      mockSql.mockImplementation(
        (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = reconstructSql([strings, ...values]);
          if (sql.includes("pg_advisory_unlock")) {
            return Promise.reject(new Error("Connection already closed"));
          }
          return Promise.resolve([{ acquired: true, still_mine: true }]);
        },
      );

      // Act — should not throw despite the SQL error
      await expect(service.release()).resolves.toBeUndefined();

      // Assert — .end() is still called to close the connection
      expect(mockSqlEnd).toHaveBeenCalledTimes(1);
      // Assert — state is cleaned up
      expect((service as Record<string, unknown>).platformSql).toBeNull();
      expect(service.isCurrentlyLeader()).toBe(false);
    });

    it("should handle errors during connection close without throwing", async () => {
      // Arrange
      await service.tryAcquireLeadership(TEST_PG_URL);
      mockSql.mockClear();
      mockSqlEnd.mockClear();

      // Make the .end() call throw
      mockSqlEnd.mockImplementation(() => Promise.reject(new Error("Socket hangup")));

      // Act — should not throw despite the close error
      await expect(service.release()).resolves.toBeUndefined();

      // Assert — unlock was still attempted
      expect(mockSql).toHaveBeenCalledTimes(1);
      // Assert — state is cleaned up despite the .end() failure
      expect((service as Record<string, unknown>).platformSql).toBeNull();
      expect(service.isCurrentlyLeader()).toBe(false);
    });

    it("should clear the renewal interval when release() is called", async () => {
      // Arrange
      await service.tryAcquireLeadership(TEST_PG_URL);
      expect((service as Record<string, unknown>).renewalInterval).not.toBeNull();

      // Act
      await service.release();

      // Assert
      expect((service as Record<string, unknown>).renewalInterval).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  onModuleDestroy — should delegate to release()
  // ════════════════════════════════════════════════════════════════════════

  describe("onModuleDestroy", () => {
    it("should call pg_advisory_unlock during module destruction", async () => {
      // Arrange
      await service.tryAcquireLeadership(TEST_PG_URL);
      mockSql.mockClear();

      // Act
      await service.onModuleDestroy();

      // Assert
      const unlockCalls = (mockSql.mock.calls as unknown[][]).filter(
        (call) => reconstructSql(call).includes("pg_advisory_unlock"),
      );
      expect(unlockCalls.length).toBeGreaterThan(0);
    });

    it("should clear the renewal interval and close the connection", async () => {
      // Arrange
      await service.tryAcquireLeadership(TEST_PG_URL);
      mockSqlEnd.mockClear();

      // Act
      await service.onModuleDestroy();

      // Assert — interval is cleared
      expect(
        (service as Record<string, unknown>).renewalInterval,
      ).toBeNull();
      // Connection is closed (via .end())
      expect(mockSqlEnd).toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  Leadership loss during renewal → release
  // ════════════════════════════════════════════════════════════════════════

  describe("renewal — leadership loss", () => {
    it("should call pg_advisory_unlock when renewal detects the lock is no longer held", async () => {
      // Arrange
      await service.tryAcquireLeadership(TEST_PG_URL);
      mockSql.mockClear();
      mockSqlEnd.mockClear();

      // Make the next pg_try_advisory_lock call (from the renewal) report
      // that the lock is no longer ours.
      mockSql.mockImplementation(
        (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = reconstructSql([strings, ...values]);
          if (sql.includes("pg_try_advisory_lock")) {
            return Promise.resolve([{ still_mine: false }]);
          }
          return Promise.resolve([{ acquired: true }]);
        },
      );

      // Act — trigger the captured renewal callback
      expect(capturedRenewalFn).not.toBeNull();
      await capturedRenewalFn!();

      // Assert
      const unlockCalls = (mockSql.mock.calls as unknown[][]).filter(
        (call) => reconstructSql(call).includes("pg_advisory_unlock"),
      );
      expect(unlockCalls.length).toBeGreaterThan(0);
    });
  });
});
