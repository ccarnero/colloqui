import { describe, expect, it } from "bun:test";
import type { RawChainEventRow } from "../../src/lib/normalize-chain-event-row.js";
import { normalizeChainEventRow } from "../../src/lib/normalize-chain-event-row.js";

function sampleRawEvent(
  overrides: Partial<RawChainEventRow> = {}
): RawChainEventRow {
  return {
    event_id: "evt-1",
    subject: "evt.tenant-a.channel-service.messaging.whatsapp.meta.received.v1",
    tenant: "tenant-a",
    producer: "channel-service",
    domain: "messaging",
    kind: "received",
    version: "v1",
    correlation_id: "corr-1",
    causation_id: null,
    causation_depth: 0,
    occurred_at: "2026-07-11T12:00:00.000Z",
    tech: "whatsapp",
    business_fn: "messaging",
    rule: 3,
    consumed_by: [],
    is_claim_check: false,
    compliance: "full",
    workflow_id: null,
    run_id: null,
    connector_id: null,
    cache_status: null,
    has_envelope: true,
    ...overrides,
  };
}

describe("normalizeChainEventRow", () => {
  it("converts a driver Date occurred_at to a millisecond-precision ISO string", () => {
    // Regression (T02 defect 1, attempt 2 live smoke test): the postgres
    // driver returns timestamptz columns as Date objects; downstream
    // Date.parse() on such a Date silently drops milliseconds.
    const row = sampleRawEvent({
      occurred_at: new Date("2026-07-11T15:38:33.726Z"),
    });
    expect(normalizeChainEventRow(row).occurred_at).toBe(
      "2026-07-11T15:38:33.726Z"
    );
  });

  it("passes through a string occurred_at unmodified in precision", () => {
    const row = sampleRawEvent({
      occurred_at: "2026-07-11T15:38:33.838Z",
    });
    expect(normalizeChainEventRow(row).occurred_at).toBe(
      "2026-07-11T15:38:33.838Z"
    );
  });

  it("leaves every other column untouched", () => {
    const row = sampleRawEvent({ event_id: "evt-2", rule: 7 });
    const normalized = normalizeChainEventRow(row);
    expect(normalized.event_id).toBe("evt-2");
    expect(normalized.rule).toBe(7);
    expect(normalized.tenant).toBe("tenant-a");
  });
});
