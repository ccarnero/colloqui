/** Ensures config loaders succeed before importing application modules in tests. */
process.env.MONGO_PASSWORD ??= process.env.POSTGRES_PASSWORD ?? "test";
process.env.POSTGRES_PASSWORD ??= "test";
process.env.STORAGE_ENGINE ??= "mongo";

/**
 * Polyfill vi.mocked for Bun 1.3 (not available natively in bun:test).
 * bun:test's vi does not implement the `mocked` helper; this provides a
 * pass-through that preserves mock method access.
 *
 * Uses require() to access bun:test synchronously in the test setup phase.
 */
try {
  const { vi } = require("bun:test") as typeof import("bun:test");
  if (typeof vi !== "undefined" && typeof (vi as any).mocked === "undefined") {
    (vi as any).mocked = <T>(fn: T): T & {
      mockResolvedValue: (v: unknown) => void;
      mockRejectedValue: (e: unknown) => void;
    } =>
      fn as any;
  }
} catch {
  // Not in test context — skip polyfill
}
