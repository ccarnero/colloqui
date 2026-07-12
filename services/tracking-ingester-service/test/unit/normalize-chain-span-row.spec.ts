import { describe, expect, it } from "bun:test";
import type { RawChainSpanRow } from "../../src/lib/normalize-chain-span-row.js";
import { normalizeChainSpanRow } from "../../src/lib/normalize-chain-span-row.js";

function sampleRawSpan(
  overrides: Partial<RawChainSpanRow> = {}
): RawChainSpanRow {
  return {
    event_id: "evt-span-1",
    causation_id: null,
    kind_prefix: "execution",
    entity_id: "run-1",
    started_at: "2026-07-11T12:00:00.000Z",
    completed_at: "2026-07-11T12:00:00.000Z",
    duration_ms: 0,
    ...overrides,
  };
}

describe("normalizeChainSpanRow", () => {
  it("converts driver Date started_at/completed_at to millisecond-precision ISO strings", () => {
    // Regression (T02 defect 1, attempt 2 live smoke test).
    const row = sampleRawSpan({
      started_at: new Date("2026-07-11T15:38:33.726Z"),
      completed_at: new Date("2026-07-11T15:38:33.838Z"),
    });
    const normalized = normalizeChainSpanRow(row);
    expect(normalized.started_at).toBe("2026-07-11T15:38:33.726Z");
    expect(normalized.completed_at).toBe("2026-07-11T15:38:33.838Z");
  });

  it("coerces a string duration_ms to a number", () => {
    // Regression (T02 defect 2, attempt 2 live smoke test): the view's
    // duration_ms is a Postgres numeric/bigint, which the driver returns as
    // a string ("0" in the live response instead of 0).
    const row = sampleRawSpan({ duration_ms: "112" });
    const normalized = normalizeChainSpanRow(row);
    expect(normalized.duration_ms).toBe(112);
    expect(typeof normalized.duration_ms).toBe("number");
  });

  it("passes through an already-numeric duration_ms unchanged", () => {
    const row = sampleRawSpan({ duration_ms: 42 });
    const normalized = normalizeChainSpanRow(row);
    expect(normalized.duration_ms).toBe(42);
    expect(typeof normalized.duration_ms).toBe("number");
  });

  it("leaves kind_prefix/entity_id untouched", () => {
    const row = sampleRawSpan({ kind_prefix: "workflow", entity_id: "wf-1" });
    const normalized = normalizeChainSpanRow(row);
    expect(normalized.kind_prefix).toBe("workflow");
    expect(normalized.entity_id).toBe("wf-1");
  });
});
