// Unit tests for the T4 click-through detail column extractor
// (.sdd/changes/trace-visualization/tasks.md T4): workflow_id/run_id for
// workflow-execution events (rule 19), connector_id/cache_status for
// connector-invocation events (rule 11). Absent/unrelated → all four null,
// never throw.

import { describe, expect, it } from "bun:test";
import { extractDetailColumns } from "../src/lib/extract-detail-columns.js";

describe("extractDetailColumns — workflow events (rule 19)", () => {
  it("extracts workflowId + runId when both are present", () => {
    const result = extractDetailColumns(19, {
      workflowId: "wf-abc",
      runId: "run-123",
      executionId: "exec-1",
    });
    expect(result).toEqual({
      workflow_id: "wf-abc",
      run_id: "run-123",
      connector_id: null,
      cache_status: null,
    });
  });

  it("falls back to executionId as workflow_id when workflowId is absent", () => {
    // Current live shape (execution-completed-publisher.activity.ts) only
    // publishes { executionId, status, workflowName } — no Temporal
    // workflowId/runId. executionId is the best available identifier.
    const result = extractDetailColumns(19, {
      executionId: "exec-1",
      status: "COMPLETED",
    });
    expect(result.workflow_id).toBe("exec-1");
    expect(result.run_id).toBeNull();
  });

  it("returns nulls (never throws) for a null payload", () => {
    const result = extractDetailColumns(19, null);
    expect(result).toEqual({
      workflow_id: null,
      run_id: null,
      connector_id: null,
      cache_status: null,
    });
  });
});

describe("extractDetailColumns — connector events (rule 11)", () => {
  it("extracts adapterId as connector_id + cacheResult as cache_status (cache hit)", () => {
    const result = extractDetailColumns(11, {
      adapterId: "adapter-x",
      endpointId: "ep-1",
      cacheResult: "hit",
    });
    expect(result).toEqual({
      workflow_id: null,
      run_id: null,
      connector_id: "adapter-x",
      cache_status: "hit",
    });
  });

  it("extracts connector without a cache result (cacheResult null)", () => {
    const result = extractDetailColumns(11, {
      adapterId: "adapter-x",
      endpointId: "ep-1",
      cacheResult: null,
    });
    expect(result.connector_id).toBe("adapter-x");
    expect(result.cache_status).toBeNull();
  });

  it("falls back to endpointId when adapterId is absent", () => {
    const result = extractDetailColumns(11, { endpointId: "ep-1" });
    expect(result.connector_id).toBe("ep-1");
  });
});

describe("extractDetailColumns — unrelated events", () => {
  it("returns all-null for a non-workflow, non-connector rule", () => {
    const result = extractDetailColumns(3, {
      some: "channel-processing-payload",
    });
    expect(result).toEqual({
      workflow_id: null,
      run_id: null,
      connector_id: null,
      cache_status: null,
    });
  });

  it("never throws on unexpected payload shapes (string, array, number)", () => {
    expect(() => extractDetailColumns(19, "not-an-object")).not.toThrow();
    expect(() => extractDetailColumns(11, [1, 2, 3])).not.toThrow();
    expect(() => extractDetailColumns(11, 42)).not.toThrow();
    expect(extractDetailColumns(19, "not-an-object")).toEqual({
      workflow_id: null,
      run_id: null,
      connector_id: null,
      cache_status: null,
    });
  });
});
