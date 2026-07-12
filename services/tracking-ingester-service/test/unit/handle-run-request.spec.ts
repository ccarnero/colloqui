import { describe, expect, it } from "bun:test";
import type { RunEventRow } from "../../src/lib/build-run-events-query.js";
import type { ChainSpanRow } from "../../src/lib/build-spans-query.js";
import { handleRunRequest } from "../../src/lib/handle-run-request.js";

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

const NO_SPANS: readonly ChainSpanRow[] = [];

describe("handleRunRequest", () => {
  it("returns 400 when tenant is missing (stubbed pool never called)", async () => {
    let called = false;
    const result = await handleRunRequest("wf-1", "run-1", null, {
      queryRoot: async () => {
        called = true;
        return [];
      },
      queryEvents: async () => {
        called = true;
        return [];
      },
      querySpans: async () => {
        called = true;
        return [];
      },
    });
    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it("returns 400 for a blank tenant header", async () => {
    const result = await handleRunRequest("wf-1", "run-1", "  ", {
      queryRoot: async () => [],
      queryEvents: async () => [],
      querySpans: async () => [],
    });
    expect(result.status).toBe(400);
  });

  it("returns 404 when the root query resolves no correlation (unknown run)", async () => {
    let eventsQueried = false;
    const result = await handleRunRequest("wf-1", "run-1", "tenant-a", {
      queryRoot: async () => [],
      queryEvents: async () => {
        eventsQueried = true;
        return [];
      },
      querySpans: async () => [],
    });
    expect(result.status).toBe(404);
    expect(eventsQueried).toBe(false);
  });

  it("routes the root query params correctly", async () => {
    const result = await handleRunRequest("wf-1", "run-1", "tenant-a", {
      queryRoot: async (query) => {
        expect(query.params).toEqual(["wf-1", "run-1", "tenant-a"]);
        return [];
      },
      queryEvents: async () => [],
      querySpans: async () => [],
    });
    expect(result.status).toBe(404);
  });

  it("resolves the correlation, fetches events+spans scoped to it, and shapes a 200 response", async () => {
    const seenQueries: unknown[] = [];
    const result = await handleRunRequest("wf-1", "run-1", "tenant-a", {
      queryRoot: async (query) => {
        seenQueries.push(query);
        return [{ correlation_id: "corr-1" }];
      },
      queryEvents: async (query) => {
        seenQueries.push(query);
        expect(query.params).toEqual(["corr-1", "tenant-a"]);
        return [
          event({
            event_id: "evt-1",
            kind: "execution_started",
            payload_execution_id: "exec-1",
          }),
          event({
            event_id: "evt-2",
            kind: "execution_completed",
            occurred_at: "2026-07-01T00:00:02.000Z",
            workflow_id: "exec-1",
            run_id: null,
            payload_step_status: "COMPLETED",
          }),
        ];
      },
      querySpans: async (query) => {
        seenQueries.push(query);
        expect(query.params).toEqual(["corr-1", "tenant-a"]);
        return NO_SPANS;
      },
    });

    expect(seenQueries.length).toBe(3);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.workflow_id).toBe("wf-1");
      expect(result.body.run_id).toBe("run-1");
      expect(result.body.correlation_id).toBe("corr-1");
      expect(result.body.summary.status).toBe("completed");
      expect(result.body.events).toHaveLength(2);
    }
  });

  it("returns 404 if the events re-fetch unexpectedly comes back empty", async () => {
    const result = await handleRunRequest("wf-1", "run-1", "tenant-a", {
      queryRoot: async () => [{ correlation_id: "corr-1" }],
      queryEvents: async () => [],
      querySpans: async () => [],
    });
    expect(result.status).toBe(404);
  });

  it("does not leak a sibling run's step events into this run's summary/events (T01 attempt 2, cross-run-leakage fix — a shared trigger fired two workflows on the same correlation)", async () => {
    const result = await handleRunRequest("wf-agent", "run-agent", "tenant-a", {
      queryRoot: async () => [{ correlation_id: "corr-shared" }],
      queryEvents: async () => [
        // Run under test: 1 agentCall action.
        event({
          event_id: "started-agent",
          kind: "execution_started",
          workflow_id: "wf-agent",
          run_id: "run-agent",
          payload_execution_id: "exec-agent",
        }),
        event({
          event_id: "step-agent-1",
          kind: "action_completed",
          causation_id: "started-agent",
          workflow_id: "exec-agent",
          run_id: null,
          payload_step_status: "ok",
        }),
        // Sibling run from the SAME shared trigger: 1 jsFunction action —
        // must never be counted against the run under test.
        event({
          event_id: "started-log",
          kind: "execution_started",
          workflow_id: "wf-log",
          run_id: "run-log",
          payload_execution_id: "exec-log",
        }),
        event({
          event_id: "step-log-1",
          kind: "action_completed",
          causation_id: "started-log",
          workflow_id: "exec-log",
          run_id: null,
          payload_step_status: "ok",
        }),
      ],
      querySpans: async () => NO_SPANS,
    });

    expect(result.status).toBe(200);
    if (result.status === 200) {
      // Live defect this regresses: the agent run wrongly reported
      // steps_ok: 2 (its own agentCall PLUS the sibling's jsFunction).
      expect(result.body.summary.steps_ok).toBe(1);
      expect(result.body.events).toHaveLength(2);
      expect(result.body.events.map((e) => e.event_id).sort()).toEqual(
        ["started-agent", "step-agent-1"].sort()
      );
    }
  });
});
