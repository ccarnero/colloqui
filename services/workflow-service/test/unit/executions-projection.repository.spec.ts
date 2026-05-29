import "reflect-metadata";
import { describe, it, expect } from "bun:test";
import { ExecutionsProjectionMongoRepository } from "../../src/modules/executions-projector/executions.mongo.repository";
import type { WorkflowTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { makeFakeTenantMongoConnections, makeMockDb } from "../make-mongo-mock";

function buildRepo(bulkWrite: (
  ops: unknown[],
  options: { ordered: boolean },
) => Promise<{ modifiedCount: number }>): ExecutionsProjectionMongoRepository {
  const bulkWriteFn = bulkWrite;
  const db = makeMockDb({
    workflow_executions: {
      bulkWrite: bulkWriteFn,
    },
  });
  const connections = makeFakeTenantMongoConnections(
    db,
  ) as unknown as WorkflowTenantConnectionManager;
  return new ExecutionsProjectionMongoRepository(connections);
}

describe("ExecutionsProjectionMongoRepository.applyStatusBatch", () => {
  it("returns 0 and performs no query when rows is empty", async () => {
    let calls = 0;
    const repo = buildRepo(async () => {
      calls += 1;
      return { modifiedCount: 0 };
    });
    const n = await repo.applyStatusBatch("t1", []);
    expect(n).toBe(0);
    expect(calls).toBe(0);
  });

  it("emits a single bulkWrite for N rows", async () => {
    let capturedOps: unknown[] | undefined;
    let capturedOrdered: boolean | undefined;
    const repo = buildRepo(async (ops, options) => {
      capturedOps = ops;
      capturedOrdered = options.ordered;
      return { modifiedCount: 3 };
    });
    const n = await repo.applyStatusBatch("t1", [
      { id: "11111111-1111-1111-1111-111111111111", status: "COMPLETED" },
      { id: "22222222-2222-2222-2222-222222222222", status: "COMPLETED" },
      { id: "33333333-3333-3333-3333-333333333333", status: "FAILED" },
    ]);
    expect(n).toBe(3);
    expect(capturedOps).toHaveLength(3);
    expect(capturedOrdered).toBe(false);

    const first = (capturedOps as Array<{ updateOne: { filter: { _id: string } } }>)[0];
    expect(first?.updateOne.filter._id).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
  });

  it("returns the raw modifiedCount from the driver", async () => {
    const repo = buildRepo(async () => ({ modifiedCount: 7 }));
    const n = await repo.applyStatusBatch("t1", [
      { id: "a", status: "COMPLETED" },
      { id: "b", status: "COMPLETED" },
      { id: "c", status: "COMPLETED" },
    ]);
    expect(n).toBe(7);
  });

  it("passes non-UUID (nanoid) ids through unchanged", async () => {
    const nanoLikeIds = ["V1StGXR8_Z5jdHi6B-myT", "abc_123-DEF"];
    let capturedOps: Array<{ updateOne: { filter: { _id: string } } }> = [];
    const repo = buildRepo(async (ops) => {
      capturedOps = ops as typeof capturedOps;
      return { modifiedCount: 2 };
    });
    const n = await repo.applyStatusBatch("t1", [
      { id: nanoLikeIds[0]!, status: "COMPLETED" },
      { id: nanoLikeIds[1]!, status: "FAILED" },
    ]);

    expect(n).toBe(2);
    expect(capturedOps[0]?.updateOne.filter._id).toBe(nanoLikeIds[0]);
    expect(capturedOps[1]?.updateOne.filter._id).toBe(nanoLikeIds[1]);
  });
});
