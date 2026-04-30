import "reflect-metadata";
import { describe, it, expect } from "bun:test";
import { ExecutionsProjectionRepository } from "../../src/modules/executions-projector/executions.repository";
import type { WorkflowTenantConnectionManager } from "../../src/providers/tenant-connection-manager";

/**
 * Builds a `sql` tag mock that records its calls and returns a
 * configured `count`. Verifies the repository is composing a single
 * batched statement regardless of input size.
 */
function buildSqlMock(count: number) {
  const calls: Array<{ strings: TemplateStringsArray; args: unknown[] }> = [];
  const sqlFn = ((strings: TemplateStringsArray, ...args: unknown[]) => {
    calls.push({ strings, args });
    return Promise.resolve(
      Object.assign([] as unknown[], { count }),
    ) as unknown as Promise<{ count: number } & unknown[]>;
  }) as unknown as (
    strings: TemplateStringsArray,
    ...args: unknown[]
  ) => Promise<{ count: number } & unknown[]>;
  return { sqlFn, calls };
}

function buildRepo(sqlFn: unknown): ExecutionsProjectionRepository {
  const connections = {
    ensureSchema: () => Promise.resolve(sqlFn),
  } as unknown as WorkflowTenantConnectionManager;
  return new ExecutionsProjectionRepository(connections);
}

describe("ExecutionsProjectionRepository.applyStatusBatch", () => {
  it("returns 0 and performs no query when rows is empty", async () => {
    const { sqlFn, calls } = buildSqlMock(0);
    const repo = buildRepo(sqlFn);
    const n = await repo.applyStatusBatch("t1", []);
    expect(n).toBe(0);
    expect(calls.length).toBe(0);
  });

  it("emits a single batched UPDATE statement for N rows", async () => {
    const { sqlFn, calls } = buildSqlMock(3);
    const repo = buildRepo(sqlFn);
    const n = await repo.applyStatusBatch("t1", [
      { id: "11111111-1111-1111-1111-111111111111", status: "COMPLETED" },
      { id: "22222222-2222-2222-2222-222222222222", status: "COMPLETED" },
      { id: "33333333-3333-3333-3333-333333333333", status: "FAILED" },
    ]);
    expect(n).toBe(3);
    expect(calls.length).toBe(1);

    const templateSrc = calls[0]!.strings.join("?");
    expect(templateSrc).toContain("UPDATE workflow_executions");
    expect(templateSrc).toContain("unnest");
    expect(templateSrc).toContain("SET status");

    // Two interpolated args: the ids array and the statuses array.
    expect(calls[0]!.args.length).toBe(2);
    expect(Array.isArray(calls[0]!.args[0])).toBe(true);
    expect(Array.isArray(calls[0]!.args[1])).toBe(true);
    expect((calls[0]!.args[0] as string[]).length).toBe(3);
    expect((calls[0]!.args[1] as string[]).length).toBe(3);
  });

  it("returns the raw affected-row count from the driver", async () => {
    const { sqlFn } = buildSqlMock(7);
    const repo = buildRepo(sqlFn);
    const n = await repo.applyStatusBatch("t1", [
      { id: "a", status: "COMPLETED" },
      { id: "b", status: "COMPLETED" },
      { id: "c", status: "COMPLETED" },
    ]);
    expect(n).toBe(7);
  });

  // Regression: `WorkflowsService.executeWorkflow` assigns execution ids
  // with `nanoid()` (e.g. "V1StGXR8_Z5jdHi6B") which do NOT parse as
  // UUIDs. The cast must be `text[]` to match `workflow_executions.id TEXT`.
  it("passes non-UUID (nanoid) ids through unchanged and casts to text[], not uuid[]", async () => {
    const { sqlFn, calls } = buildSqlMock(2);
    const repo = buildRepo(sqlFn);
    const nanoLikeIds = ["V1StGXR8_Z5jdHi6B-myT", "abc_123-DEF"];
    const n = await repo.applyStatusBatch("t1", [
      { id: nanoLikeIds[0]!, status: "COMPLETED" },
      { id: nanoLikeIds[1]!, status: "FAILED" },
    ]);

    expect(n).toBe(2);
    expect(calls.length).toBe(1);

    const templateSrc = calls[0]!.strings.join("?");
    expect(templateSrc).toContain("::text[]");
    expect(templateSrc).not.toContain("::uuid[]");

    // Ids must reach the driver byte-for-byte (no normalization/coercion).
    const idsArg = calls[0]!.args[0] as string[];
    expect(idsArg).toEqual(nanoLikeIds);
  });
});
