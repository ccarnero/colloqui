import { describe, expect, it } from "bun:test";
import type { RunEventRow } from "../../src/lib/build-run-events-query.js";
import { scopeRunEvents } from "../../src/lib/scope-run-events.js";

function event(overrides: Partial<RunEventRow>): RunEventRow {
  return {
    event_id: "evt-1",
    subject: "s",
    tenant: "tenant-a",
    producer: "workflow-service",
    domain: "workflow",
    kind: "execution_started",
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
    workflow_id: "wf-1",
    run_id: "run-1",
    connector_id: null,
    cache_status: null,
    payload_status: "inline",
    payload_scrubbed_at: null,
    has_envelope: true,
    payload_connector_id: null,
    payload_agent_id: null,
    payload_step_status: null,
    payload_execution_id: null,
    ...overrides,
  };
}

describe("scopeRunEvents", () => {
  it("returns an empty scope when the (workflowId, runId) execution_started row is not present", () => {
    const scoped = scopeRunEvents(
      [event({ kind: "action_started", causation_id: "nope" })],
      "wf-1",
      "run-1"
    );
    expect(scoped.runEvents).toEqual([]);
    expect(scoped.startedEvent).toBeNull();
    expect(scoped.executionId).toBeNull();
  });

  it("returns just the started row when it has no step events or completion yet", () => {
    const started = event({
      event_id: "started-1",
      kind: "execution_started",
      payload_execution_id: "exec-1",
    });
    const scoped = scopeRunEvents([started], "wf-1", "run-1");
    expect(scoped.runEvents).toEqual([started]);
    expect(scoped.startedEvent).toBe(started);
    expect(scoped.executionId).toBe("exec-1");
  });

  it("includes step events whose causation_id matches the started row's event_id", () => {
    const started = event({
      event_id: "started-1",
      kind: "execution_started",
      payload_execution_id: "exec-1",
    });
    const step = event({
      event_id: "step-1",
      kind: "action_completed",
      causation_id: "started-1",
      workflow_id: "exec-1",
      run_id: null,
    });
    const scoped = scopeRunEvents([started, step], "wf-1", "run-1");
    expect(scoped.runEvents).toEqual([started, step]);
  });

  it("excludes step events whose causation_id points at a DIFFERENT run's execution_started row (cross-run-leakage fix)", () => {
    const started = event({
      event_id: "started-A",
      kind: "execution_started",
      workflow_id: "wf-A",
      run_id: "run-A",
      payload_execution_id: "exec-A",
    });
    const siblingStep = event({
      event_id: "step-B-1",
      kind: "action_completed",
      causation_id: "started-B",
      workflow_id: "exec-B",
      run_id: null,
    });
    const scoped = scopeRunEvents([started, siblingStep], "wf-A", "run-A");
    expect(scoped.runEvents).toEqual([started]);
  });

  it("includes condition_evaluated events matching the started row's causation_id", () => {
    const started = event({
      event_id: "started-1",
      kind: "execution_started",
      payload_execution_id: "exec-1",
    });
    const condition = event({
      event_id: "cond-1",
      kind: "condition_evaluated",
      causation_id: "started-1",
      workflow_id: "exec-1",
      run_id: null,
    });
    const scoped = scopeRunEvents([started, condition], "wf-1", "run-1");
    expect(scoped.runEvents).toEqual([started, condition]);
  });

  it("matches execution_completed by workflow_id column against the started row's payload_execution_id", () => {
    const started = event({
      event_id: "started-1",
      kind: "execution_started",
      payload_execution_id: "exec-1",
    });
    const completed = event({
      event_id: "completed-1",
      kind: "execution_completed",
      workflow_id: "exec-1",
      run_id: null,
      occurred_at: "2026-07-01T00:00:01.000Z",
    });
    const scoped = scopeRunEvents([started, completed], "wf-1", "run-1");
    expect(scoped.runEvents).toEqual([started, completed]);
  });

  it("excludes a SIBLING run's execution_completed (different executionId in its workflow_id column)", () => {
    const started = event({
      event_id: "started-A",
      kind: "execution_started",
      workflow_id: "wf-A",
      run_id: "run-A",
      payload_execution_id: "exec-A",
    });
    const siblingCompleted = event({
      event_id: "completed-B",
      kind: "execution_completed",
      workflow_id: "exec-B",
      run_id: null,
    });
    const scoped = scopeRunEvents([started, siblingCompleted], "wf-A", "run-A");
    expect(scoped.runEvents).toEqual([started]);
  });

  it("excludes context/trigger events (e.g. webhook ingress) even though they share the correlation", () => {
    const trigger = event({
      event_id: "trigger-1",
      kind: "received",
      producer: "channel-service",
      domain: "messaging",
      tech: "http-generic",
      business_fn: "ingress",
      rule: 2,
      workflow_id: null,
      run_id: null,
    });
    const started = event({
      event_id: "started-1",
      kind: "execution_started",
      payload_execution_id: "exec-1",
    });
    const scoped = scopeRunEvents([trigger, started], "wf-1", "run-1");
    expect(scoped.runEvents).toEqual([started]);
  });

  it("sorts the scoped runEvents by occurred_at", () => {
    const started = event({
      event_id: "started-1",
      kind: "execution_started",
      payload_execution_id: "exec-1",
      occurred_at: "2026-07-01T00:00:00.000Z",
    });
    const step = event({
      event_id: "step-1",
      kind: "action_started",
      causation_id: "started-1",
      workflow_id: "exec-1",
      run_id: null,
      occurred_at: "2026-07-01T00:00:01.000Z",
    });
    const scoped = scopeRunEvents([step, started], "wf-1", "run-1");
    expect(scoped.runEvents.map((e) => e.event_id)).toEqual([
      "started-1",
      "step-1",
    ]);
  });
});
