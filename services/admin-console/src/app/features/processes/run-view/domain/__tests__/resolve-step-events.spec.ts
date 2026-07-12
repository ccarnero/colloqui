import { describe, expect, it } from "vitest";
import type { IRunEvent } from "../../../../../core/services/run-view.service";
import { parseNodeId, resolveStepEvents } from "../resolve-step-events";
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

describe("parseNodeId", () => {
  it("parses a root-level action id", () => {
    expect(parseNodeId("root::0")).toEqual({
      branchPath: null,
      actionIndex: 0,
      isJoin: false,
    });
  });

  it("parses a nested branch-path action id", () => {
    expect(parseNodeId("pathA/approved::2")).toEqual({
      branchPath: "pathA/approved",
      actionIndex: 2,
      isJoin: false,
    });
  });

  it("parses a join id", () => {
    expect(parseNodeId("root::1::join")).toEqual({
      branchPath: null,
      actionIndex: 1,
      isJoin: true,
    });
  });

  it("returns null fields for an unrecognized id shape", () => {
    expect(parseNodeId("garbage")).toEqual({
      branchPath: null,
      actionIndex: null,
      isJoin: false,
    });
  });
});

describe("resolveStepEvents", () => {
  it("matches the started/completed pair for a root-level action node", () => {
    const events = [
      event({
        event_id: "evt-1",
        kind: "action_started",
        payload_action_index: 0,
      }),
      event({
        event_id: "evt-2",
        kind: "action_completed",
        payload_action_index: 0,
      }),
    ];
    const result = resolveStepEvents(node({ id: "root::0" }), events);
    expect(result.started).toEqual({
      eventId: "evt-1",
      occurredAt: "2026-07-11T10:00:00.000Z",
    });
    expect(result.completed).toEqual({
      eventId: "evt-2",
      occurredAt: "2026-07-11T10:00:00.000Z",
    });
  });

  it("matches by branchPath, not just actionIndex, for a nested action", () => {
    const events = [
      event({
        event_id: "outer",
        kind: "action_started",
        payload_action_index: 0,
        payload_branch: null,
      }),
      event({
        event_id: "inner",
        kind: "action_started",
        payload_action_index: 0,
        payload_branch: "approved",
      }),
    ];
    const result = resolveStepEvents(node({ id: "approved::0" }), events);
    expect(result.started?.eventId).toBe("inner");
  });

  it("matches a condition_evaluated event by its own conditionEventId for a conditional node", () => {
    const events = [
      event({
        event_id: "cond-1",
        kind: "condition_evaluated",
        payload_action_index: 1,
        occurred_at: "2026-07-11T10:00:01.000Z",
      }),
    ];
    const result = resolveStepEvents(
      node({
        id: "root::1",
        kind: "conditional",
        actionType: null,
        conditionEventId: "cond-1",
      }),
      events
    );
    expect(result.started).toEqual({
      eventId: "cond-1",
      occurredAt: "2026-07-11T10:00:01.000Z",
    });
    expect(result.completed).toEqual({
      eventId: "cond-1",
      occurredAt: "2026-07-11T10:00:01.000Z",
    });
  });

  it("resolves the NESTED conditional's own event, not the root's, when both share the same local actionIndex (regression)", () => {
    // Root `if` at position 1 and a nested `if` (inside the root's taken
    // branch) also at LOCAL position 1 — `condition_evaluated` carries no
    // `branch` field, so both events have `payload_action_index === 1`.
    // Only `conditionEventId` (threaded from `merge-run.ts`'s tree-order
    // consumption) tells them apart; matching by `actionIndex` alone (the
    // bug this test guards against) would always return the FIRST one —
    // the root's — for the nested node too.
    const events = [
      event({
        event_id: "root-cond",
        kind: "condition_evaluated",
        payload_action_index: 1,
        payload_expression: "root.expr",
        payload_evaluated_value: "true",
        occurred_at: "2026-07-11T10:00:01.000Z",
      }),
      event({
        event_id: "nested-cond",
        kind: "condition_evaluated",
        payload_action_index: 1,
        payload_expression: "nested.expr",
        payload_evaluated_value: "false",
        occurred_at: "2026-07-11T10:00:02.000Z",
      }),
    ];

    const rootResult = resolveStepEvents(
      node({
        id: "root::1",
        kind: "conditional",
        actionType: null,
        conditionEventId: "root-cond",
      }),
      events
    );
    const nestedResult = resolveStepEvents(
      node({
        id: "approved::1",
        kind: "conditional",
        actionType: null,
        conditionEventId: "nested-cond",
      }),
      events
    );

    expect(rootResult.started).toEqual({
      eventId: "root-cond",
      occurredAt: "2026-07-11T10:00:01.000Z",
    });
    expect(nestedResult.started).toEqual({
      eventId: "nested-cond",
      occurredAt: "2026-07-11T10:00:02.000Z",
    });
    expect(nestedResult.started?.eventId).not.toBe(rootResult.started?.eventId);
  });

  it("returns null/null for a join pill (no event of its own)", () => {
    const events = [
      event({
        event_id: "evt-1",
        kind: "action_started",
        payload_action_index: 0,
      }),
    ];
    const result = resolveStepEvents(
      node({ id: "root::0::join", kind: "join", actionType: null }),
      events
    );
    expect(result).toEqual({ started: null, completed: null });
  });

  it("returns null/null when no matching event exists (not-executed step)", () => {
    const result = resolveStepEvents(node({ id: "root::5" }), []);
    expect(result).toEqual({ started: null, completed: null });
  });
});
