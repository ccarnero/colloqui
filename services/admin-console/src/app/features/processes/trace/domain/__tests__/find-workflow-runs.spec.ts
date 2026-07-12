import { describe, expect, it } from "vitest";
import type { ITrackedEvent } from "../../../../../core/services/tracking-chain.service";
import { findWorkflowRuns } from "../find-workflow-runs";

function event(overrides: Partial<ITrackedEvent>): ITrackedEvent {
  return {
    event_id: "evt-x",
    subject: "evt.acme.channel-service.messaging.telegram.telegram.received.v1",
    tenant: "acme",
    producer: "channel-service",
    domain: "channel",
    kind: "received",
    version: "v1",
    correlation_id: "corr-1",
    causation_id: null,
    causation_depth: 0,
    occurred_at: "2026-01-01T00:00:00.000Z",
    tech: "telegram",
    business_fn: "channel-processing",
    rule: 3,
    consumed_by: [],
    is_claim_check: false,
    compliance: "full",
    workflow_id: null,
    run_id: null,
    connector_id: null,
    cache_status: null,
    has_envelope: true,
    payload_action_name: null,
    ...overrides,
  };
}

describe("findWorkflowRuns", () => {
  it("returns an empty array when no event carries both workflow_id and run_id", () => {
    const events = [
      event({ event_id: "evt-1" }),
      // action_completed-shaped: workflow_id falls back to executionId,
      // run_id stays null (IActionEventArgs has no runId field) — must
      // NOT be treated as a resolvable run.
      event({ event_id: "evt-2", workflow_id: "exec-1", run_id: null }),
    ];

    expect(findWorkflowRuns(events)).toEqual([]);
  });

  it("extracts a run when an event carries both ids (execution_started)", () => {
    const events = [
      event({ event_id: "evt-1" }),
      event({
        event_id: "evt-2",
        producer: "workflow-service",
        domain: "workflow",
        kind: "execution_started",
        rule: 19,
        workflow_id: "acme:order-workflow:abc123",
        run_id: "run-9",
      }),
    ];

    expect(findWorkflowRuns(events)).toEqual([
      { workflowId: "acme:order-workflow:abc123", runId: "run-9" },
    ]);
  });

  it("dedupes repeated (workflow_id, run_id) pairs, preserving first-seen order", () => {
    const events = [
      event({ event_id: "evt-1", workflow_id: "wf-a", run_id: "run-a" }),
      event({ event_id: "evt-2", workflow_id: "wf-a", run_id: "run-a" }),
      event({ event_id: "evt-3", workflow_id: "wf-b", run_id: "run-b" }),
    ];

    expect(findWorkflowRuns(events)).toEqual([
      { workflowId: "wf-a", runId: "run-a" },
      { workflowId: "wf-b", runId: "run-b" },
    ]);
  });

  it("handles a shared-trigger fan-out into multiple distinct runs", () => {
    const events = [
      event({ event_id: "evt-1", workflow_id: "wf-a", run_id: "run-a" }),
      event({ event_id: "evt-2", workflow_id: "wf-b", run_id: "run-b" }),
    ];

    expect(findWorkflowRuns(events)).toHaveLength(2);
  });
});
