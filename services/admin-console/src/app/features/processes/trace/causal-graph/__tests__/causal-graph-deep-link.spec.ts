import { describe, expect, it } from "vitest";
import type { ITrackedEvent } from "../../../../../core/services/tracking-chain.service";
import { resolveTrackedEventDeepLink } from "../causal-graph-deep-link";

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

describe("resolveTrackedEventDeepLink", () => {
  it("resolves the connector route for an endpoint_call_completed event with a connector_id", () => {
    const result = resolveTrackedEventDeepLink(
      event({ kind: "endpoint_call_completed", connector_id: "adapter-9" })
    );
    expect(result).toEqual({
      route: ["/connections/http", "adapter-9"],
      label: "Open connector",
    });
  });

  it("returns null when kind is endpoint_call_completed but connector_id is missing", () => {
    const result = resolveTrackedEventDeepLink(
      event({ kind: "endpoint_call_completed", connector_id: null })
    );
    expect(result).toBeNull();
  });

  it("returns null for an agent-execution event (no agentId column on ITrackedEvent — documented gap)", () => {
    const result = resolveTrackedEventDeepLink(
      event({ kind: "execution_started", business_fn: "workflow-execution" })
    );
    expect(result).toBeNull();
  });

  it("returns null for an unrelated event kind", () => {
    const result = resolveTrackedEventDeepLink(event({ kind: "dlq_replayed" }));
    expect(result).toBeNull();
  });
});
