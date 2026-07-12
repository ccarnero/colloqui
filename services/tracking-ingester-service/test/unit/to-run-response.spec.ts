import { describe, expect, it } from "bun:test";
import type { RunEventRow } from "../../src/lib/build-run-events-query.js";
import type { ChainSpanRow } from "../../src/lib/build-spans-query.js";
import { toRunResponse } from "../../src/lib/to-run-response.js";

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

/** The run's `execution_started` row — every fixture below anchors its step
 * events to THIS row's `event_id` (as `causation_id`) and `executionId`
 * (as `payload_execution_id` on the started row / `workflow_id` on
 * `execution_completed`), mirroring `workflows.ts`'s real causal wiring
 * (T01 cross-run-leakage fix, manual-loops/run-view.md attempt 2). */
function startedEvent(overrides: Partial<RunEventRow> = {}): RunEventRow {
  return event({
    event_id: "started-1",
    kind: "execution_started",
    workflow_id: "wf-1",
    run_id: "run-1",
    payload_execution_id: "exec-1",
    ...overrides,
  });
}

function stepEvent(overrides: Partial<RunEventRow>): RunEventRow {
  return event({
    causation_id: "started-1",
    workflow_id: "exec-1",
    run_id: null,
    ...overrides,
  });
}

function completedEvent(overrides: Partial<RunEventRow> = {}): RunEventRow {
  return event({
    event_id: "completed-1",
    kind: "execution_completed",
    workflow_id: "exec-1",
    run_id: null,
    ...overrides,
  });
}

const NO_SPANS: readonly ChainSpanRow[] = [];

describe("toRunResponse", () => {
  it("shapes the basic envelope: ids, tenant, and the run-scoped events/spans", () => {
    const events = [startedEvent()];
    const response = toRunResponse(
      "wf-1",
      "run-1",
      "corr-1",
      "tenant-a",
      events,
      NO_SPANS
    );
    expect(response.workflow_id).toBe("wf-1");
    expect(response.run_id).toBe("run-1");
    expect(response.correlation_id).toBe("corr-1");
    expect(response.tenant).toBe("tenant-a");
    expect(response.events).toEqual(events);
    expect(response.spans).toEqual(NO_SPANS);
  });

  it("derives status 'running' when execution_started exists but no execution_completed", () => {
    const events = [startedEvent()];
    const response = toRunResponse(
      "wf-1",
      "run-1",
      "corr-1",
      "tenant-a",
      events,
      NO_SPANS
    );
    expect(response.summary.status).toBe("running");
    expect(response.summary.completed_at).toBeNull();
  });

  it("derives status 'completed' when execution_completed's payload status is not FAILED", () => {
    const events = [
      startedEvent({ occurred_at: "2026-07-01T00:00:00.000Z" }),
      completedEvent({
        occurred_at: "2026-07-01T00:00:01.000Z",
        payload_step_status: "COMPLETED",
      }),
    ];
    const response = toRunResponse(
      "wf-1",
      "run-1",
      "corr-1",
      "tenant-a",
      events,
      NO_SPANS
    );
    expect(response.summary.status).toBe("completed");
    expect(response.summary.started_at).toBe("2026-07-01T00:00:00.000Z");
    expect(response.summary.completed_at).toBe("2026-07-01T00:00:01.000Z");
    expect(response.summary.total_ms).toBe(1000);
  });

  it("derives status 'failed' when execution_completed's payload status is FAILED", () => {
    const events = [
      startedEvent(),
      completedEvent({ payload_step_status: "FAILED" }),
    ];
    const response = toRunResponse(
      "wf-1",
      "run-1",
      "corr-1",
      "tenant-a",
      events,
      NO_SPANS
    );
    expect(response.summary.status).toBe("failed");
  });

  it("counts steps_ok/steps_failed from the run's own action_completed payload status", () => {
    const events = [
      startedEvent(),
      stepEvent({
        event_id: "evt-1",
        kind: "action_completed",
        payload_step_status: "ok",
      }),
      stepEvent({
        event_id: "evt-2",
        kind: "action_completed",
        payload_step_status: "ok",
      }),
      stepEvent({
        event_id: "evt-3",
        kind: "action_completed",
        payload_step_status: "failed",
      }),
      stepEvent({
        event_id: "evt-4",
        kind: "action_completed",
        payload_step_status: "skipped",
      }),
      stepEvent({ event_id: "evt-5", kind: "action_started" }),
    ];
    const response = toRunResponse(
      "wf-1",
      "run-1",
      "corr-1",
      "tenant-a",
      events,
      NO_SPANS
    );
    expect(response.summary.steps_ok).toBe(2);
    expect(response.summary.steps_failed).toBe(1);
  });

  it("sets step_detail true when any step-level event kind is present", () => {
    const events = [
      startedEvent(),
      stepEvent({ event_id: "evt-2", kind: "action_started" }),
    ];
    const response = toRunResponse(
      "wf-1",
      "run-1",
      "corr-1",
      "tenant-a",
      events,
      NO_SPANS
    );
    expect(response.step_detail).toBe(true);
  });

  it("sets step_detail false for a run with zero step events (pre-deploy)", () => {
    const events = [
      startedEvent(),
      completedEvent({ payload_step_status: "COMPLETED" }),
    ];
    const response = toRunResponse(
      "wf-1",
      "run-1",
      "corr-1",
      "tenant-a",
      events,
      NO_SPANS
    );
    expect(response.step_detail).toBe(false);
  });

  it("includes the aggregated cast from the run's own step events", () => {
    const events = [
      startedEvent(),
      stepEvent({
        event_id: "evt-1",
        kind: "action_started",
        payload_agent_id: "agent-1",
      }),
    ];
    const response = toRunResponse(
      "wf-1",
      "run-1",
      "corr-1",
      "tenant-a",
      events,
      NO_SPANS
    );
    expect(response.cast).toEqual([
      { kind: "agent", id: "agent-1", name: "agent-1", count: 1 },
    ]);
  });

  it("returns an empty run when the (workflowId, runId) execution_started row is not found among the fetched events (defensive)", () => {
    const events = [stepEvent({ event_id: "evt-1", kind: "action_started" })];
    const response = toRunResponse(
      "wf-1",
      "run-1",
      "corr-1",
      "tenant-a",
      events,
      NO_SPANS
    );
    expect(response.events).toEqual([]);
    expect(response.summary.status).toBe("running");
    expect(response.step_detail).toBe(false);
  });

  describe("cross-run-leakage fix (T01 attempt 2)", () => {
    // Two runs share one correlation (a shared trigger fired both workflows,
    // e.g. e2e-http-log + e2e-http-agent both firing off the same webhook).
    // Run A has 1 agentCall action; Run B has 1 jsFunction action. Fetching
    // the WHOLE correlation (as the DB query does) hands toRunResponse
    // BOTH runs' events — it must scope down to only the requested run's
    // own events/spans/summary/cast.
    const runAStarted = startedEvent({
      event_id: "started-A",
      workflow_id: "wf-A",
      run_id: "run-A",
      payload_execution_id: "exec-A",
    });
    const runAStep = event({
      event_id: "step-A-1",
      kind: "action_completed",
      causation_id: "started-A",
      workflow_id: "exec-A",
      run_id: null,
      payload_agent_id: "agent-1",
      payload_step_status: "ok",
    });
    const runACompleted = event({
      event_id: "completed-A",
      kind: "execution_completed",
      workflow_id: "exec-A",
      run_id: null,
      payload_step_status: "COMPLETED",
      occurred_at: "2026-07-01T00:00:02.000Z",
    });

    const runBStarted = startedEvent({
      event_id: "started-B",
      workflow_id: "wf-B",
      run_id: "run-B",
      payload_execution_id: "exec-B",
    });
    const runBStep = event({
      event_id: "step-B-1",
      kind: "action_completed",
      causation_id: "started-B",
      workflow_id: "exec-B",
      run_id: null,
      payload_step_status: "ok",
    });
    const runBCompleted = event({
      event_id: "completed-B",
      kind: "execution_completed",
      workflow_id: "exec-B",
      run_id: null,
      payload_step_status: "COMPLETED",
      occurred_at: "2026-07-01T00:00:02.000Z",
    });

    const sharedCorrelationEvents = [
      runAStarted,
      runBStarted,
      runAStep,
      runBStep,
      runACompleted,
      runBCompleted,
    ];

    it("run A's steps/summary/cast are unaffected by run B's events", () => {
      const response = toRunResponse(
        "wf-A",
        "run-A",
        "corr-shared",
        "tenant-a",
        sharedCorrelationEvents,
        NO_SPANS
      );
      expect(response.summary.steps_ok).toBe(1);
      expect(response.summary.steps_failed).toBe(0);
      expect(response.events.map((e) => e.event_id).sort()).toEqual(
        ["completed-A", "started-A", "step-A-1"].sort()
      );
      expect(response.cast).toEqual([
        { kind: "agent", id: "agent-1", name: "agent-1", count: 1 },
      ]);
    });

    it("run B's steps/summary/cast are unaffected by run A's events", () => {
      const response = toRunResponse(
        "wf-B",
        "run-B",
        "corr-shared",
        "tenant-a",
        sharedCorrelationEvents,
        NO_SPANS
      );
      expect(response.summary.steps_ok).toBe(1);
      expect(response.summary.steps_failed).toBe(0);
      expect(response.events.map((e) => e.event_id).sort()).toEqual(
        ["completed-B", "started-B", "step-B-1"].sort()
      );
      // Run B never touched an agent — no agent-1 leakage from run A.
      expect(response.cast).toEqual([]);
    });
  });
});
