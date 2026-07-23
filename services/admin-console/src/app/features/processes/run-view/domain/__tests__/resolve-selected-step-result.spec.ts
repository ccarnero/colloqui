import { describe, expect, it } from "vitest";
import type { IRunEvent } from "../../../../../core/services/run-view.service";
import { resolveSelectedStepResult } from "../resolve-selected-step-result";
import type { ILayoutNode } from "../run-view.model";

function event(overrides: Partial<IRunEvent>): IRunEvent {
  return {
    event_id: "evt-x",
    subject: "workflow.action.started.v1",
    tenant: "acme",
    producer: "workflow-service",
    domain: "workflow",
    kind: "action_started",
    version: "v1",
    correlation_id: "corr-1",
    causation_id: null,
    causation_depth: 1,
    occurred_at: "2026-07-11T10:00:00.000Z",
    tech: "temporal",
    business_fn: "workflow-execution",
    rule: 19,
    consumed_by: [],
    is_claim_check: false,
    compliance: "full",
    workflow_id: "wf-1",
    run_id: "run-1",
    connector_id: null,
    cache_status: null,
    has_envelope: true,
    payload_connector_id: null,
    payload_agent_id: null,
    payload_step_status: null,
    payload_execution_id: "exec-1",
    payload_action_index: null,
    payload_action_type: null,
    payload_action_name: null,
    payload_branch: null,
    payload_expression: null,
    payload_evaluated_value: null,
    payload_branch_taken: null,
    payload_cases: null,
    ...overrides,
  };
}

function node(overrides: Partial<ILayoutNode>): ILayoutNode {
  return {
    id: "root::0",
    kind: "action",
    color: "platform",
    label: "1 · endpointCall → order-api",
    status: "ok",
    row: 0,
    lane: 0,
    onSpine: true,
    nestingDepth: 0,
    durationMs: 120,
    dashed: false,
    instanceId: "order-api",
    evaluatedValue: null,
    branchTaken: null,
    actionType: "endpointCall",
    stepName: "callOrderApi",
    conditionEventId: null,
    ...overrides,
  };
}

describe("resolveSelectedStepResult", () => {
  it("returns null when nothing is selected", () => {
    expect(resolveSelectedStepResult([node({})], [], null)).toBeNull();
  });

  it("returns null when the selected event id matches none of the run's own step events", () => {
    const events = [
      event({
        event_id: "started-1",
        kind: "action_started",
        payload_action_index: 0,
      }),
    ];
    expect(
      resolveSelectedStepResult(
        [node({ id: "root::0" })],
        events,
        "some-other-event"
      )
    ).toBeNull();
  });

  it("resolves the node whose COMPLETED event matches the selection", () => {
    const events = [
      event({
        event_id: "started-1",
        kind: "action_started",
        payload_action_index: 0,
      }),
      event({
        event_id: "completed-1",
        kind: "action_completed",
        payload_action_index: 0,
      }),
    ];
    const result = resolveSelectedStepResult(
      [node({ id: "root::0", status: "ok", durationMs: 120 })],
      events,
      "completed-1"
    );
    expect(result).toEqual({
      nodeId: "root::0",
      stepName: "callOrderApi",
      kind: "action",
      actionType: "endpointCall",
      status: "ok",
      durationMs: 120,
      branchTaken: null,
      evaluatedValue: null,
      instanceId: "order-api",
    });
  });

  it("resolves the node whose STARTED event matches the selection", () => {
    const events = [
      event({
        event_id: "started-1",
        kind: "action_started",
        payload_action_index: 0,
      }),
    ];
    const result = resolveSelectedStepResult(
      [node({ id: "root::0" })],
      events,
      "started-1"
    );
    expect(result?.nodeId).toBe("root::0");
  });

  it("resolves a conditional node via its own condition_evaluated event (point event, same instant)", () => {
    const events = [
      event({
        event_id: "cond-1",
        kind: "condition_evaluated",
        payload_action_index: 1,
      }),
    ];
    const result = resolveSelectedStepResult(
      [
        node({
          id: "root::1",
          kind: "conditional",
          actionType: null,
          conditionEventId: "cond-1",
          branchTaken: "high",
          evaluatedValue: "320",
        }),
      ],
      events,
      "cond-1"
    );
    expect(result).toMatchObject({
      nodeId: "root::1",
      kind: "conditional",
      branchTaken: "high",
      evaluatedValue: "320",
    });
  });

  it("carries a FAILED step's real status through untouched (no invented recovery/success)", () => {
    const events = [
      event({
        event_id: "completed-1",
        kind: "action_completed",
        payload_action_index: 0,
      }),
    ];
    const result = resolveSelectedStepResult(
      [node({ id: "root::0", status: "failed" })],
      events,
      "completed-1"
    );
    expect(result?.status).toBe("failed");
  });

  it("skips a join pill (no event of its own) when scanning for a match", () => {
    const events = [
      event({
        event_id: "evt-1",
        kind: "action_started",
        payload_action_index: 0,
      }),
    ];
    const result = resolveSelectedStepResult(
      [
        node({ id: "root::0::join", kind: "join", actionType: null }),
        node({ id: "root::0" }),
      ],
      events,
      "evt-1"
    );
    expect(result?.nodeId).toBe("root::0");
  });
});
