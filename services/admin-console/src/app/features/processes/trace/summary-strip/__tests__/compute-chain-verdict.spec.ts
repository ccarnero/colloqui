import { describe, expect, it } from "vitest";
import type {
  ITrackedEvent,
  ITrackingChainResponse,
} from "../../../../../core/services/tracking-chain.service";
import { computeChainVerdict } from "../compute-chain-verdict";

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

function chain(events: readonly ITrackedEvent[]): ITrackingChainResponse {
  return {
    correlation_id: "corr-1",
    tenant: "acme",
    events: [...events],
    spans: [],
    summary: {
      count: events.length,
      first_at: events[0]?.occurred_at ?? null,
      last_at: events.at(-1)?.occurred_at ?? null,
      total_ms: 0,
      orphan_count: 0,
    },
  };
}

describe("computeChainVerdict", () => {
  it("cannot distinguish a FAILED delivery — a send with no further signal reads 'published-unconfirmed' (DATA-GAP: ITrackedEvent has no delivery/outcome field; a genuinely failed send is indistinguishable from an unconfirmed one today — backend follow-up)", () => {
    const failedDeliveryChain = chain([
      event({ event_id: "e1", kind: "received" }),
      // In the legacy pipeline this send would carry delivery: "failed" and
      // deriveVerdict would return "failed"; the chain shape carries no such
      // field, so the reduced derivation reports published-unconfirmed.
      event({ event_id: "e2", kind: "send" }),
    ]);
    expect(computeChainVerdict(failedDeliveryChain)).toBe(
      "published-unconfirmed"
    );
  });

  it("returns 'replied' when a sent event is present — egress delivery confirmation, same rule as assemble-trace.ts's deriveVerdict", () => {
    const c = chain([
      event({ event_id: "e1", kind: "received" }),
      event({ event_id: "e2", kind: "send" }),
      event({ event_id: "e3", kind: "sent" }),
    ]);
    expect(computeChainVerdict(c)).toBe("replied");
  });

  it("returns 'published-unconfirmed' when send is present but sent never arrives", () => {
    const c = chain([
      event({ event_id: "e1", kind: "received" }),
      event({ event_id: "e2", kind: "send" }),
    ]);
    expect(computeChainVerdict(c)).toBe("published-unconfirmed");
  });

  it("returns 'received' when only a received event is present", () => {
    const c = chain([event({ event_id: "e1", kind: "received" })]);
    expect(computeChainVerdict(c)).toBe("received");
  });

  it("returns null for workflow-only chains with no received/send/sent kind (e.g. http-generic executions) — hides rather than invents", () => {
    const c = chain([
      event({ event_id: "e1", kind: "execution_started" }),
      event({ event_id: "e2", kind: "action_completed" }),
    ]);
    expect(computeChainVerdict(c)).toBeNull();
  });

  it("returns null for an empty chain", () => {
    expect(computeChainVerdict(chain([]))).toBeNull();
  });
});
