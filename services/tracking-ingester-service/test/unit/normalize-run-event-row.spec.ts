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
});
