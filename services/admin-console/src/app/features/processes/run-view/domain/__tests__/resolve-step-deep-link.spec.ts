import { describe, expect, it } from "vitest";
import type { IRunEvent } from "../../../../../core/services/run-view.service";
import { resolveStepDeepLink } from "../resolve-step-deep-link";
import type { ILayoutNode } from "../run-view.model";

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

function runEvent(overrides: Partial<IRunEvent>): IRunEvent {
  return {
    event_id: "evt-x",
    subject: "workflow.action.completed.v1",
    tenant: "acme",
    producer: "workflow-service",
    domain: "workflow",
    kind: "action_completed",
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
    payload_step_status: "ok",
    payload_execution_id: "exec-1",
    payload_action_index: 0,
    payload_action_type: "endpointCall",
    payload_action_name: "callOrderApi",
    payload_branch: null,
    payload_expression: null,
    payload_evaluated_value: null,
    payload_branch_taken: null,
    payload_cases: null,
    ...overrides,
  };
}

describe("resolveStepDeepLink", () => {
  it("resolves the connector route from the completed event's payload_connector_id", () => {
    const result = resolveStepDeepLink(node({}), [
      runEvent({
        event_id: "evt-completed",
        kind: "action_completed",
        payload_action_index: 0,
        payload_connector_id: "adapter-9",
      }),
    ]);
    expect(result).toEqual({
      route: ["/connections/http", "adapter-9"],
      label: "Open connector",
    });
  });

  it("resolves the agent route from the completed event's payload_agent_id", () => {
    const result = resolveStepDeepLink(node({ actionType: "agentCall" }), [
      runEvent({
        event_id: "evt-completed",
        kind: "action_completed",
        payload_action_index: 0,
        payload_agent_id: "agent-7",
      }),
    ]);
    expect(result).toEqual({
      route: ["/ai/agents", "agent-7"],
      label: "Open agent",
    });
  });

  it("falls back to the started event when no completed event matched yet", () => {
    const result = resolveStepDeepLink(node({}), [
      runEvent({
        event_id: "evt-started",
        kind: "action_started",
        payload_action_index: 0,
        payload_connector_id: "adapter-9",
      }),
    ]);
    expect(result).toEqual({
      route: ["/connections/http", "adapter-9"],
      label: "Open connector",
    });
  });

  it("returns null for a step with neither connector nor agent id (e.g. jsFunction)", () => {
    const result = resolveStepDeepLink(node({ actionType: "jsFunction" }), [
      runEvent({
        event_id: "evt-completed",
        kind: "action_completed",
        payload_action_index: 0,
      }),
    ]);
    expect(result).toBeNull();
  });

  it("returns null for structural nodes (join)", () => {
    const result = resolveStepDeepLink(
      node({ id: "fork1::0::join", kind: "join" }),
      []
    );
    expect(result).toBeNull();
  });

  it("returns null when no matching event exists yet", () => {
    const result = resolveStepDeepLink(node({}), []);
    expect(result).toBeNull();
  });
});
