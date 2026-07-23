import { describe, expect, it } from "vitest";
import type { IRunEvent } from "../../../../../core/services/run-view.service";
import { resolveSelectedStepDeepLink } from "../resolve-selected-step-deep-link";
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

describe("resolveSelectedStepDeepLink", () => {
  it("returns null when nothing is selected", () => {
    expect(resolveSelectedStepDeepLink([node({})], [], null)).toBeNull();
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
      resolveSelectedStepDeepLink(
        [node({ id: "root::0" })],
        events,
        "some-other-event"
      )
    ).toBeNull();
  });

  it("resolves the matched node's connector deep link when its completed event carries payload_connector_id", () => {
    const events = [
      event({
        event_id: "completed-1",
        kind: "action_completed",
        payload_action_index: 0,
        payload_connector_id: "adapter-42",
      }),
    ];
    const result = resolveSelectedStepDeepLink(
      [node({ id: "root::0" })],
      events,
      "completed-1"
    );
    expect(result).toEqual({
      route: ["/connections/http", "adapter-42"],
      label: "Open connector",
    });
  });

  it("resolves the matched node's agent deep link when its completed event carries payload_agent_id", () => {
    const events = [
      event({
        event_id: "completed-1",
        kind: "action_completed",
        payload_action_index: 0,
        payload_agent_id: "agent-7",
      }),
    ];
    const result = resolveSelectedStepDeepLink(
      [node({ id: "root::0" })],
      events,
      "completed-1"
    );
    expect(result).toEqual({
      route: ["/ai/agents", "agent-7"],
      label: "Open agent",
    });
  });

  it("skips a join pill (no event of its own) and resolves the matching sibling node", () => {
    const events = [
      event({
        event_id: "completed-1",
        kind: "action_completed",
        payload_action_index: 0,
        payload_connector_id: "adapter-42",
      }),
    ];
    const result = resolveSelectedStepDeepLink(
      [
        node({ id: "root::0::join", kind: "join", actionType: null }),
        node({ id: "root::0" }),
      ],
      events,
      "completed-1"
    );
    expect(result).toEqual({
      route: ["/connections/http", "adapter-42"],
      label: "Open connector",
    });
  });

  it("returns null when the matched step has neither connector nor agent id (e.g. a not-executed structural step)", () => {
    const events = [
      event({
        event_id: "started-1",
        kind: "action_started",
        payload_action_index: 0,
      }),
    ];
    const result = resolveSelectedStepDeepLink(
      [node({ id: "root::0" })],
      events,
      "started-1"
    );
    expect(result).toBeNull();
  });
});
