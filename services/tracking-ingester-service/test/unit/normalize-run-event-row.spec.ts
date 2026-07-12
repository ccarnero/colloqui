import { describe, expect, it } from "bun:test";
import type { RunEventRow } from "../../src/lib/build-run-events-query.js";
import {
  normalizeRunEventRow,
  type RawRunEventRow,
} from "../../src/lib/normalize-run-event-row.js";

const BASE: RunEventRow = {
  event_id: "evt-1",
  subject:
    "evt.tenant-a.workflow-service.workflow.internal.native.action_started.v1",
  tenant: "tenant-a",
  producer: "workflow-service",
  domain: "workflow",
  kind: "action_started",
  version: "v1",
  correlation_id: "corr-1",
  causation_id: null,
  causation_depth: 0,
  occurred_at: "2026-07-01T00:00:00.000Z",
  tech: "platform",
  business_fn: "workflow-execution",
  rule: 19,
  consumed_by: [],
  is_claim_check: false,
  compliance: "full",
  workflow_id: "exec-1",
  run_id: null,
  connector_id: null,
  cache_status: null,
  payload_status: "inline",
  payload_scrubbed_at: null,
  has_envelope: true,
  payload_connector_id: null,
  payload_agent_id: null,
  payload_step_status: null,
  payload_execution_id: null,
  payload_action_index: null,
  payload_action_type: null,
  payload_action_name: null,
  payload_branch: null,
  payload_expression: null,
  payload_evaluated_value: null,
  payload_branch_taken: null,
  payload_cases: null,
};

describe("normalizeRunEventRow", () => {
  it("normalizes a Date occurred_at into an ISO-8601 millisecond string", () => {
    const raw: RawRunEventRow = {
      ...BASE,
      occurred_at: new Date("2026-07-11T15:38:33.726Z"),
    };
    const normalized = normalizeRunEventRow(raw);
    expect(normalized.occurred_at).toBe("2026-07-11T15:38:33.726Z");
    expect(typeof normalized.occurred_at).toBe("string");
  });

  it("passes through an already-string occurred_at unchanged", () => {
    const raw: RawRunEventRow = {
      ...BASE,
      occurred_at: "2026-07-01T00:00:00.000Z",
    };
    const normalized = normalizeRunEventRow(raw);
    expect(normalized.occurred_at).toBe("2026-07-01T00:00:00.000Z");
  });

  it("preserves the payload-derived columns verbatim", () => {
    const raw: RawRunEventRow = {
      ...BASE,
      payload_connector_id: "adapter-1",
      payload_agent_id: null,
      payload_step_status: "ok",
    };
    const normalized = normalizeRunEventRow(raw);
    expect(normalized.payload_connector_id).toBe("adapter-1");
    expect(normalized.payload_agent_id).toBeNull();
    expect(normalized.payload_step_status).toBe("ok");
  });

  it("normalizes payload_action_index from a numeric text string to a number", () => {
    const raw: RawRunEventRow = {
      ...BASE,
      kind: "action_started",
      payload_action_index: "2",
    };
    const normalized = normalizeRunEventRow(raw);
    expect(normalized.payload_action_index).toBe(2);
    expect(typeof normalized.payload_action_index).toBe("number");
  });

  it("normalizes a null payload_action_index to null", () => {
    const raw: RawRunEventRow = { ...BASE, payload_action_index: null };
    const normalized = normalizeRunEventRow(raw);
    expect(normalized.payload_action_index).toBeNull();
  });

  it("degrades a non-numeric payload_action_index to null instead of NaN", () => {
    const raw: RawRunEventRow = {
      ...BASE,
      payload_action_index: "not-a-number",
    };
    const normalized = normalizeRunEventRow(raw);
    expect(normalized.payload_action_index).toBeNull();
  });

  it("passes the T03 step/condition detail columns through unchanged for a step event", () => {
    const raw: RawRunEventRow = {
      ...BASE,
      kind: "action_started",
      payload_action_index: "0",
      payload_action_type: "endpointCall",
      payload_action_name: "callOrderApi",
      payload_branch: "approved",
    };
    const normalized = normalizeRunEventRow(raw);
    expect(normalized.payload_action_type).toBe("endpointCall");
    expect(normalized.payload_action_name).toBe("callOrderApi");
    expect(normalized.payload_branch).toBe("approved");
  });

  it("passes condition_evaluated's expression/evaluatedValue/branchTaken/cases through unchanged", () => {
    const raw: RawRunEventRow = {
      ...BASE,
      kind: "condition_evaluated",
      payload_action_index: "1",
      payload_expression: "{{results.score.value}}",
      payload_evaluated_value: "320",
      payload_branch_taken: "100-500",
      payload_cases: ["<100", "100-500", ">500"],
    };
    const normalized = normalizeRunEventRow(raw);
    expect(normalized.payload_expression).toBe("{{results.score.value}}");
    expect(normalized.payload_evaluated_value).toBe("320");
    expect(normalized.payload_branch_taken).toBe("100-500");
    expect(normalized.payload_cases).toEqual(["<100", "100-500", ">500"]);
  });

  it("leaves the T03 step/condition detail columns null for a non-step event (e.g. execution_started)", () => {
    const raw: RawRunEventRow = {
      ...BASE,
      kind: "execution_started",
      payload_action_index: null,
    };
    const normalized = normalizeRunEventRow(raw);
    expect(normalized.payload_action_index).toBeNull();
    expect(normalized.payload_action_type).toBeNull();
    expect(normalized.payload_action_name).toBeNull();
    expect(normalized.payload_branch).toBeNull();
    expect(normalized.payload_expression).toBeNull();
    expect(normalized.payload_evaluated_value).toBeNull();
    expect(normalized.payload_branch_taken).toBeNull();
    expect(normalized.payload_cases).toBeNull();
  });
});
