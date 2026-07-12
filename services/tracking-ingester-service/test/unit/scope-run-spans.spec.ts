import { describe, expect, it } from "bun:test";
import type { ChainSpanRow } from "../../src/lib/build-spans-query.js";
import { scopeRunSpans } from "../../src/lib/scope-run-spans.js";

function span(overrides: Partial<ChainSpanRow>): ChainSpanRow {
  return {
    event_id: "evt-span-1",
    causation_id: null,
    kind_prefix: "action",
    entity_id: null,
    started_at: "2026-07-01T00:00:00.000Z",
    completed_at: "2026-07-01T00:00:00.000Z",
    duration_ms: 0,
    ...overrides,
  };
}

describe("scopeRunSpans", () => {
  it("returns an empty array when both identifiers are null", () => {
    expect(scopeRunSpans([span({})], null, null)).toEqual([]);
  });

  it("includes the workflow-execution span by entity_id === executionId", () => {
    const executionSpan = span({
      event_id: "started-1",
      kind_prefix: "execution",
      entity_id: "exec-1",
    });
    expect(scopeRunSpans([executionSpan], "started-1", "exec-1")).toEqual([
      executionSpan,
    ]);
  });

  it("includes step spans by causation_id === startedEventId", () => {
    const stepSpan = span({
      event_id: "step-1",
      causation_id: "started-1",
      kind_prefix: "action",
    });
    expect(scopeRunSpans([stepSpan], "started-1", "exec-1")).toEqual([
      stepSpan,
    ]);
  });

  it("includes the started row's own span by event_id === startedEventId even when unpaired", () => {
    const startedSpan = span({
      event_id: "started-1",
      causation_id: null,
      entity_id: null,
      kind_prefix: "execution",
    });
    expect(scopeRunSpans([startedSpan], "started-1", "exec-1")).toEqual([
      startedSpan,
    ]);
  });

  it("excludes a sibling run's spans (different entity_id AND causation_id)", () => {
    const siblingExecutionSpan = span({
      event_id: "started-B",
      entity_id: "exec-B",
      kind_prefix: "execution",
    });
    const siblingStepSpan = span({
      event_id: "step-B-1",
      causation_id: "started-B",
      kind_prefix: "action",
    });
    expect(
      scopeRunSpans(
        [siblingExecutionSpan, siblingStepSpan],
        "started-A",
        "exec-A"
      )
    ).toEqual([]);
  });

  it("scopes a mixed correlation's spans down to one run", () => {
    const runExecutionSpan = span({
      event_id: "started-A",
      entity_id: "exec-A",
      kind_prefix: "execution",
    });
    const runStepSpan = span({
      event_id: "step-A-1",
      causation_id: "started-A",
      kind_prefix: "action",
    });
    const siblingExecutionSpan = span({
      event_id: "started-B",
      entity_id: "exec-B",
      kind_prefix: "execution",
    });
    const siblingStepSpan = span({
      event_id: "step-B-1",
      causation_id: "started-B",
      kind_prefix: "action",
    });
    const scoped = scopeRunSpans(
      [runExecutionSpan, runStepSpan, siblingExecutionSpan, siblingStepSpan],
      "started-A",
      "exec-A"
    );
    expect(scoped).toEqual([runExecutionSpan, runStepSpan]);
  });
});
