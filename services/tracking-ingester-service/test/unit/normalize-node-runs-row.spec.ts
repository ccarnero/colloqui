import { describe, expect, it } from "bun:test";
import { normalizeNodeRunsRow } from "../../src/lib/normalize-node-runs-row.js";

describe("normalizeNodeRunsRow", () => {
  it("passes through well-typed numeric/string fields", () => {
    const row = normalizeNodeRunsRow({
      correlation_id: "corr-1",
      occurred_at: "2026-07-27T10:00:00.000Z",
      duration_ms: 395,
      step_status: "ok",
    });
    expect(row).toEqual({
      correlation_id: "corr-1",
      occurred_at: "2026-07-27T10:00:00.000Z",
      duration_ms: 395,
      step_status: "ok",
    });
  });

  it("coerces a driver-string duration_ms to a number", () => {
    const row = normalizeNodeRunsRow({
      correlation_id: "corr-1",
      occurred_at: "2026-07-27T10:00:00.000Z",
      duration_ms: "395.5",
      step_status: "ok",
    });
    expect(row.duration_ms).toBe(395.5);
  });

  it("degrades a malformed duration_ms to null, never NaN", () => {
    const row = normalizeNodeRunsRow({
      correlation_id: "corr-1",
      occurred_at: "2026-07-27T10:00:00.000Z",
      duration_ms: "not-a-number",
      step_status: "ok",
    });
    expect(row.duration_ms).toBeNull();
  });

  it("converts a Date occurred_at to an ISO string", () => {
    const row = normalizeNodeRunsRow({
      correlation_id: "corr-1",
      occurred_at: new Date("2026-07-27T10:00:00.000Z"),
      duration_ms: 100,
      step_status: "ok",
    });
    expect(row.occurred_at).toBe("2026-07-27T10:00:00.000Z");
  });

  it("passes through a null step_status", () => {
    const row = normalizeNodeRunsRow({
      correlation_id: "corr-1",
      occurred_at: "2026-07-27T10:00:00.000Z",
      duration_ms: 100,
      step_status: null,
    });
    expect(row.step_status).toBeNull();
  });
});
