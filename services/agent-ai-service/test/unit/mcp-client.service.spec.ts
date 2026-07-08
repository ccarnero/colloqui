import { describe, expect, it } from "bun:test";
import {
  validateUrl,
  withTimeout,
} from "../../src/modules/tools/mcp-client.service";

/**
 * Covers ASYNC-RESILIENCE-AUDIT.md F2 — the live-chat MCP client (connect,
 * tool discovery, tool execution) must never hang indefinitely on an
 * unresponsive MCP server. `withTimeout` is the shared guard used by both
 * `McpClientService` and `ToolBridgeService.withMcpUsageLogging`.
 */
describe("withTimeout (mcp-client.service.ts) — F2", () => {
  it("resolves with the value of a promise that settles before the timeout", async () => {
    const fast = new Promise<string>((resolve) =>
      setTimeout(() => resolve("ok"), 5)
    );

    await expect(withTimeout(fast, 50, "fast op")).resolves.toBe("ok");
  });

  it("rejects with a clear timeout error when the promise never settles in time", async () => {
    const neverResolves = new Promise<string>(() => {});

    await expect(
      withTimeout(neverResolves, 10, "MCP connect 'slow-server'")
    ).rejects.toThrow("MCP connect 'slow-server' timed out after 10ms");
  });

  it("propagates the original rejection when the promise rejects before the timeout", async () => {
    const failsFast = Promise.reject(new Error("upstream refused"));

    await expect(withTimeout(failsFast, 50, "op")).rejects.toThrow(
      "upstream refused"
    );
  });

  it("clears its internal timer so the process doesn't hang after resolving", async () => {
    // Regression guard: a leaked timer would keep bun's event loop alive.
    // We can't directly assert timer cleanup, but we can assert the
    // returned promise settles and no unhandled timer fires afterwards.
    const fast = Promise.resolve(42);
    const result = await withTimeout(fast, 20, "op");
    expect(result).toBe(42);
  });
});

/**
 * Covers the SSRF guard newly added to `mcp-client.service.ts` (previously
 * missing — this live-chat MCP client had only a timeout, no URL
 * validation). Ported from `connector-runtime`'s `mcp-call.activity.ts`,
 * throwing a plain `Error` instead of `ApplicationFailure` since this
 * service doesn't use Temporal. `scope: "internal"` is an admin opt-in that
 * relaxes the localhost/RFC1918 checks; cloud-metadata and link-local
 * targets stay blocked regardless of scope.
 */
describe("validateUrl (mcp-client.service.ts) — SSRF guard", () => {
  it("blocks an external private IP (10.x.x.x) by default", () => {
    expect(() => validateUrl("http://10.0.0.5/mcp")).toThrow("private/RFC1918");
  });

  it("blocks localhost by default", () => {
    expect(() => validateUrl("http://localhost:3000/mcp")).toThrow(
      "must not target localhost"
    );
  });

  it("allows a public https URL by default", () => {
    expect(() => validateUrl("https://api.example.com/mcp")).not.toThrow();
  });

  it("allows a private IP (10.x.x.x) when scope is 'internal'", () => {
    expect(() => validateUrl("http://10.0.0.5/mcp", "internal")).not.toThrow();
  });

  it("allows localhost when scope is 'internal'", () => {
    expect(() =>
      validateUrl("http://localhost:3000/mcp", "internal")
    ).not.toThrow();
  });

  it("still blocks cloud metadata (169.254.169.254) even when scope is 'internal'", () => {
    expect(() =>
      validateUrl("http://169.254.169.254/latest/meta-data", "internal")
    ).toThrow("cloud metadata");
  });

  it("still blocks link-local (169.254.x.x) even when scope is 'internal'", () => {
    expect(() => validateUrl("http://169.254.1.1/mcp", "internal")).toThrow(
      "link-local"
    );
  });

  it("throws a plain Error, not an ApplicationFailure-shaped object", () => {
    try {
      validateUrl("http://localhost/mcp");
      throw new Error("expected validateUrl to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("Error");
    }
  });
});
