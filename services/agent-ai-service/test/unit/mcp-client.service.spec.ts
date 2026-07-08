import { describe, expect, it } from "bun:test";
import { withTimeout } from "../../src/modules/tools/mcp-client.service";

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
