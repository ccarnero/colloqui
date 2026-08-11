import { describe, expect, it } from "bun:test";
import { aggregateRunCast } from "../../src/lib/aggregate-run-cast.js";
import type { RunEventRow } from "../../src/lib/build-run-events-query.js";

function event(overrides: Partial<RunEventRow>): RunEventRow {
  return {
    event_id: "evt-1",
    subject: "s",
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
    ...overrides,
  };
}

describe("aggregateRunCast", () => {
  it("returns an empty array for zero events", () => {
    expect(aggregateRunCast([])).toEqual([]);
  });

  it("aggregates a connector instance from the connector_id column (rule 11 events)", () => {
    const events = [
      event({ event_id: "evt-1", connector_id: "adapter-1" }),
      event({ event_id: "evt-2", connector_id: "adapter-1" }),
    ];
    expect(aggregateRunCast(events)).toEqual([
      { kind: "connector", id: "adapter-1", name: "adapter-1", count: 2 },
    ]);
  });

  it("aggregates a connector instance from the step-event payload connectorId", () => {
    const events = [
      event({
        event_id: "evt-1",
        kind: "action_started",
        payload_connector_id: "adapter-2",
      }),
    ];
    expect(aggregateRunCast(events)).toEqual([
      { kind: "connector", id: "adapter-2", name: "adapter-2", count: 1 },
    ]);
  });

  it("aggregates an agent instance from the step-event payload agentId", () => {
    const events = [
      event({ event_id: "evt-1", payload_agent_id: "agent-1" }),
      event({ event_id: "evt-2", payload_agent_id: "agent-1" }),
      event({ event_id: "evt-3", payload_agent_id: "agent-2" }),
    ];
    const cast = aggregateRunCast(events);
    expect(cast).toContainEqual({
      kind: "agent",
      id: "agent-1",
      name: "agent-1",
      count: 2,
    });
    expect(cast).toContainEqual({
      kind: "agent",
      id: "agent-2",
      name: "agent-2",
      count: 1,
    });
  });

  it("aggregates a channel instance from ingress/egress/processing events keyed by tech", () => {
    const events = [
      event({
        event_id: "evt-1",
        producer: "api-gateway",
        domain: "messaging",
        tech: "telegram",
        business_fn: "ingress",
        rule: 2,
      }),
      event({
        event_id: "evt-2",
        producer: "channel-service",
        domain: "messaging",
        tech: "telegram",
        business_fn: "channel-egress",
        rule: 4,
      }),
    ];
    expect(aggregateRunCast(events)).toEqual([
      { kind: "channel", id: "telegram", name: "telegram", count: 2 },
    ]);
  });

  it("does not aggregate a channel instance for non-channel business functions", () => {
    const events = [event({ business_fn: "workflow-execution" })];
    expect(aggregateRunCast(events)).toEqual([]);
  });

  it("never emits a tool cast entry (no tool-invocation family exists yet)", () => {
    const events = [
      event({ payload_connector_id: "adapter-1" }),
      event({ payload_agent_id: "agent-1" }),
    ];
    const cast = aggregateRunCast(events);
    expect(cast.every((entry) => entry.kind !== "tool")).toBe(true);
  });

  it("aggregates a mixed run's cast independently per kind", () => {
    const events = [
      event({
        event_id: "evt-1",
        producer: "api-gateway",
        domain: "messaging",
        tech: "http-generic",
        business_fn: "ingress",
        rule: 2,
      }),
      event({
        event_id: "evt-2",
        kind: "action_started",
        payload_connector_id: "adapter-1",
      }),
      event({
        event_id: "evt-3",
        kind: "action_completed",
        payload_connector_id: "adapter-1",
      }),
      event({
        event_id: "evt-4",
        kind: "action_started",
        payload_agent_id: "agent-1",
      }),
    ];
    const cast = aggregateRunCast(events);
    expect(cast).toHaveLength(3);
    expect(cast).toContainEqual({
      kind: "channel",
      id: "http-generic",
      name: "http-generic",
      count: 1,
    });
    expect(cast).toContainEqual({
      kind: "connector",
      id: "adapter-1",
      name: "adapter-1",
      count: 2,
    });
    expect(cast).toContainEqual({
      kind: "agent",
      id: "agent-1",
      name: "agent-1",
      count: 1,
    });
  });

  it("derives channel from a SEPARATE channelEvents argument, not the run-scoped events (T01 attempt 2, cross-run-leakage fix)", () => {
    const runEvents = [
      event({ event_id: "evt-1", payload_agent_id: "agent-1" }),
    ];
    const channelEvents = [
      event({
        event_id: "evt-trigger",
        producer: "api-gateway",
        domain: "messaging",
        tech: "http-generic",
        business_fn: "ingress",
        rule: 2,
      }),
    ];
    const cast = aggregateRunCast(runEvents, channelEvents);
    expect(cast).toContainEqual({
      kind: "agent",
      id: "agent-1",
      name: "agent-1",
      count: 1,
    });
    expect(cast).toContainEqual({
      kind: "channel",
      id: "http-generic",
      name: "http-generic",
      count: 1,
    });
  });

  it("defaults channelEvents to the same events array (backward compatible single-arg call)", () => {
    const events = [
      event({
        event_id: "evt-1",
        producer: "api-gateway",
        domain: "messaging",
        tech: "telegram",
        business_fn: "ingress",
        rule: 2,
      }),
    ];
    expect(aggregateRunCast(events)).toEqual([
      { kind: "channel", id: "telegram", name: "telegram", count: 1 },
    ]);
  });
});
