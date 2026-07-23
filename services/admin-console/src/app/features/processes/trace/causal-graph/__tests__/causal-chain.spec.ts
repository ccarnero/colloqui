import { describe, expect, it } from "vitest";
import type { ITrackedEvent } from "../../../../../core/services/tracking-chain.service";
import { computeCausalChain } from "../causal-chain";

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

describe("computeCausalChain", () => {
  it("returns the empty result when the selected event id is not in the chain", () => {
    const events = [event({ event_id: "evt-1" })];

    expect(computeCausalChain(events, "evt-missing")).toEqual({
      entries: [],
      rootUnresolvedParentId: null,
    });
  });

  describe("linear chain: A -> B -> C", () => {
    const a = event({
      event_id: "A",
      kind: "trigger.matched",
      causation_id: null,
    });
    const b = event({
      event_id: "B",
      kind: "router.evaluate",
      causation_id: "A",
    });
    const c = event({ event_id: "C", kind: "agent.invoke", causation_id: "B" });
    const events = [a, b, c];

    it("selecting C returns the full root-first ancestor path [A, B, C]", () => {
      const result = computeCausalChain(events, "C");

      expect(result.entries.map((e) => e.eventId)).toEqual(["A", "B", "C"]);
      expect(result.rootUnresolvedParentId).toBeNull();
    });

    it("marks only the selected event's entry as isSelected", () => {
      const result = computeCausalChain(events, "C");

      expect(result.entries.map((e) => e.isSelected)).toEqual([
        false,
        false,
        true,
      ]);
    });

    it("selecting the root A returns just [A]", () => {
      const result = computeCausalChain(events, "A");

      expect(result.entries.map((e) => e.eventId)).toEqual(["A"]);
      expect(result.rootUnresolvedParentId).toBeNull();
    });
  });

  describe("branched chain: A -> B, A -> D", () => {
    const a = event({
      event_id: "A",
      kind: "trigger.matched",
      causation_id: null,
    });
    const b = event({
      event_id: "B",
      kind: "router.evaluate",
      causation_id: "A",
    });
    const d = event({ event_id: "D", kind: "channel.send", causation_id: "A" });
    const events = [a, b, d];

    it("selecting D returns only its own ancestor path [A, D] — sibling B is excluded", () => {
      const result = computeCausalChain(events, "D");

      expect(result.entries.map((e) => e.eventId)).toEqual(["A", "D"]);
      expect(result.entries.some((e) => e.eventId === "B")).toBe(false);
    });

    it("selecting B returns its own ancestor path [A, B] — sibling D is excluded", () => {
      const result = computeCausalChain(events, "B");

      expect(result.entries.map((e) => e.eventId)).toEqual(["A", "B"]);
      expect(result.entries.some((e) => e.eventId === "D")).toBe(false);
    });
  });

  describe("orphan event: causation_id set but unresolved within the chain", () => {
    it("returns just the selected event and surfaces the missing parent id", () => {
      const x = event({
        event_id: "X",
        kind: "dlq_replayed",
        causation_id: "evt-missing-parent",
      });
      const result = computeCausalChain([x], "X");

      expect(result.entries.map((e) => e.eventId)).toEqual(["X"]);
      expect(result.rootUnresolvedParentId).toBe("evt-missing-parent");
    });

    it("stops the walk at the orphan even when earlier ancestors resolve", () => {
      const a = event({ event_id: "A", causation_id: "evt-missing-root" });
      const b = event({ event_id: "B", causation_id: "A" });
      const result = computeCausalChain([a, b], "B");

      expect(result.entries.map((e) => e.eventId)).toEqual(["A", "B"]);
      expect(result.rootUnresolvedParentId).toBe("evt-missing-root");
    });
  });

  describe("cycle guard (defensive — un-validated producer-set causation_id)", () => {
    it("terminates instead of looping forever when two events reference each other", () => {
      const a = event({ event_id: "A", causation_id: "B" });
      const b = event({ event_id: "B", causation_id: "A" });
      const result = computeCausalChain([a, b], "A");

      // Must terminate (this assertion running at all proves it did) and
      // never contain a duplicated event id.
      const ids = result.entries.map((e) => e.eventId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("treats a self-referencing causation_id as unresolved rather than infinite-looping", () => {
      const a = event({ event_id: "A", causation_id: "A" });
      const result = computeCausalChain([a], "A");

      expect(result.entries.map((e) => e.eventId)).toEqual(["A"]);
    });
  });
});
