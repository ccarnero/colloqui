import "../setup-env";
import { describe, expect, it, vi } from "bun:test";
import { McpUsagePostgresRepository } from "../../src/modules/mcp-servers/mcp-usage.postgres.repository";
import type { IRecordMcpUsageEventData } from "../../src/modules/mcp-servers/mcp-usage.repository.interface";

const TENANT_ID = "tenant-123";

/**
 * Minimal fake of postgres.js's tagged-template `Sql` callable, capturing
 * the joined query text (`?` in place of each interpolation) and the raw
 * values passed in, so assertions can check both the SQL shape and the
 * bound parameters without a real Postgres connection.
 */
function makeFakeSql(rows: unknown[] = []) {
  const calls: { text: string; values: unknown[] }[] = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  }) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    array: (arr: unknown[]) => unknown[];
  };
  fn.array = (arr: unknown[]) => arr;
  return { fn, calls };
}

function buildEventData(
  overrides: Partial<IRecordMcpUsageEventData> = {}
): IRecordMcpUsageEventData {
  return {
    eventId: "11111111-1111-1111-1111-111111111111",
    serverName: "github-mcp",
    toolName: "list_issues",
    success: true,
    durationMs: 42,
    ...overrides,
  };
}

describe("McpUsagePostgresRepository", () => {
  describe("record", () => {
    it("inserts the event with the producer-supplied eventId as the row id, guarded by ON CONFLICT DO NOTHING", async () => {
      const { fn, calls } = makeFakeSql();
      const repo = new McpUsagePostgresRepository({
        ensureSchema: vi.fn(async () => fn),
      } as any);

      await repo.record(TENANT_ID, buildEventData());

      expect(calls).toHaveLength(1);
      expect(calls[0]!.text).toContain("INSERT INTO mcp_call_events");
      expect(calls[0]!.text).toContain("ON CONFLICT (id) DO NOTHING");
      // First interpolated value is `id`, bound to the caller's eventId —
      // this is what makes a retried delivery (client-side retry, or a
      // redelivered Temporal activity) collide instead of duplicating.
      expect(calls[0]!.values[0]).toBe("11111111-1111-1111-1111-111111111111");
    });

    it("calling record twice with the SAME eventId issues two idempotent inserts (DB dedupes via ON CONFLICT)", async () => {
      const { fn, calls } = makeFakeSql();
      const repo = new McpUsagePostgresRepository({
        ensureSchema: vi.fn(async () => fn),
      } as any);

      const data = buildEventData({ eventId: "same-event-id" });
      await repo.record(TENANT_ID, data);
      await repo.record(TENANT_ID, data);

      // The repository itself doesn't dedupe client-side — the guarantee is
      // that both statements carry the same `id` and `ON CONFLICT (id) DO
      // NOTHING`, so at most one row survives once these reach Postgres.
      expect(calls).toHaveLength(2);
      expect(calls[0]!.values[0]).toBe(calls[1]!.values[0]);
      expect(
        calls.every((c) => c.text.includes("ON CONFLICT (id) DO NOTHING"))
      ).toBe(true);
    });

    it("binds correlation_id, causation_id, and execution_id when provided", async () => {
      const { fn, calls } = makeFakeSql();
      const repo = new McpUsagePostgresRepository({
        ensureSchema: vi.fn(async () => fn),
      } as any);

      await repo.record(
        TENANT_ID,
        buildEventData({
          correlationId: "conv-1",
          causationId: "cause-1",
          executionId: "exec-1",
        })
      );

      expect(calls[0]!.values).toContain("conv-1");
      expect(calls[0]!.values).toContain("cause-1");
      expect(calls[0]!.values).toContain("exec-1");
    });

    it("defaults correlation_id, causation_id, and execution_id to null when absent", async () => {
      const { fn, calls } = makeFakeSql();
      const repo = new McpUsagePostgresRepository({
        ensureSchema: vi.fn(async () => fn),
      } as any);

      await repo.record(TENANT_ID, buildEventData());

      // Values array layout: id, tenantId, mcpServerId, serverName, toolName,
      // success, durationMs, error, correlationId, causationId, executionId.
      const values = calls[0]!.values;
      expect(values[values.length - 3]).toBeNull();
      expect(values[values.length - 2]).toBeNull();
      expect(values[values.length - 1]).toBeNull();
    });
  });
});
