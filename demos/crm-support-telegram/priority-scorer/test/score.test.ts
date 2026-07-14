import { describe, expect, test } from "bun:test";
import {
  type AssociationFetchResult,
  BASE_SCORE,
  computeScore,
  DEGRADED_SCORE,
  MAX_SCORE,
  OPEN_DEAL_VALUE_VIP_THRESHOLD,
  SCORE_PER_OPEN_DEAL,
  UNRESOLVED_TICKETS_ESCALATION_COUNT,
} from "../src/score.js";

function ok(ids: string[]): AssociationFetchResult {
  return { ok: true, ids };
}

function failed(error: string): AssociationFetchResult {
  return { ok: false, ids: [], error };
}

describe("computeScore", () => {
  test("VIP: deal count at the threshold marks the account VIP", () => {
    const deals = Array.from(
      { length: OPEN_DEAL_VALUE_VIP_THRESHOLD },
      (_, i) => `deal-${i}`
    );
    const result = computeScore({ deals: ok(deals), tickets: ok([]) });

    expect(result.tier).toBe("vip");
    expect(result.reasons).toContain(
      `open-deals-vip-threshold-met:${OPEN_DEAL_VALUE_VIP_THRESHOLD}`
    );
    expect(result.score).toBe(
      Math.min(
        BASE_SCORE + OPEN_DEAL_VALUE_VIP_THRESHOLD * SCORE_PER_OPEN_DEAL,
        MAX_SCORE
      )
    );
  });

  test("VIP takes priority over escalation when both thresholds are met", () => {
    const deals = Array.from(
      { length: OPEN_DEAL_VALUE_VIP_THRESHOLD },
      (_, i) => `deal-${i}`
    );
    const tickets = Array.from(
      { length: UNRESOLVED_TICKETS_ESCALATION_COUNT },
      (_, i) => `ticket-${i}`
    );
    const result = computeScore({ deals: ok(deals), tickets: ok(tickets) });

    expect(result.tier).toBe("vip");
    expect(result.reasons).toContain(
      `unresolved-tickets-escalation-threshold-met:${UNRESOLVED_TICKETS_ESCALATION_COUNT}`
    );
  });

  test("escalation: unresolved tickets at the threshold, deals below VIP threshold", () => {
    const tickets = Array.from(
      { length: UNRESOLVED_TICKETS_ESCALATION_COUNT },
      (_, i) => `ticket-${i}`
    );
    const result = computeScore({
      deals: ok(["deal-1"]),
      tickets: ok(tickets),
    });

    expect(result.tier).toBe("escalation");
  });

  test("standard: no threshold triggered", () => {
    const result = computeScore({ deals: ok(["deal-1"]), tickets: ok([]) });

    expect(result.tier).toBe("standard");
    expect(result.reasons).toContain("no-threshold-triggered");
  });

  test("edge case: no deals and no tickets never crashes and stays standard", () => {
    const result = computeScore({ deals: ok([]), tickets: ok([]) });

    expect(result.tier).toBe("standard");
    expect(result.score).toBe(BASE_SCORE);
    expect(result.reasons).toContain("open-deals:0");
    expect(result.reasons).toContain("unresolved-tickets:0");
  });

  test("edge case: HubSpot error on deals fetch -> degraded score, never a crash", () => {
    const result = computeScore({
      deals: failed("hubspot-http-500"),
      tickets: ok([]),
    });

    expect(result.score).toBe(DEGRADED_SCORE);
    expect(result.tier).toBe("standard");
    expect(result.reasons).toEqual(["crm-unavailable"]);
  });

  test("edge case: HubSpot error on tickets fetch -> degraded score, never a crash", () => {
    const result = computeScore({
      deals: ok([]),
      tickets: failed("network-timeout"),
    });

    expect(result.score).toBe(DEGRADED_SCORE);
    expect(result.tier).toBe("standard");
    expect(result.reasons).toEqual(["crm-unavailable"]);
  });

  test("score is capped at MAX_SCORE for very active accounts", () => {
    const deals = Array.from({ length: 20 }, (_, i) => `deal-${i}`);
    const tickets = Array.from({ length: 20 }, (_, i) => `ticket-${i}`);
    const result = computeScore({ deals: ok(deals), tickets: ok(tickets) });

    expect(result.score).toBe(MAX_SCORE);
  });
});
