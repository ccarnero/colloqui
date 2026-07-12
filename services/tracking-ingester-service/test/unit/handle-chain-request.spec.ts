import { describe, expect, it } from "bun:test";
import type { ChainEventRow } from "../../src/lib/build-chain-query.js";
import type { ChainSpanRow } from "../../src/lib/build-spans-query.js";
import { handleChainRequest } from "../../src/lib/handle-chain-request.js";
import {
  normalizeChainEventRow,
  type RawChainEventRow,
} from "../../src/lib/normalize-chain-event-row.js";
import {
  normalizeChainSpanRow,
  type RawChainSpanRow,
} from "../../src/lib/normalize-chain-span-row.js";

const EVENT: ChainEventRow = {
  event_id: "evt-1",
  subject: "channel.whatsapp.message.received",
  tenant: "tenant-a",
  producer: "channel-service",
  domain: "channel",
  kind: "message",
  version: "1.0",
  correlation_id: "corr-1",
  causation_id: null,
  causation_depth: 0,
  occurred_at: "2026-07-01T00:00:00.000Z",
  tech: "ingress",
  business_fn: "channel-whatsapp",
  rule: 1,
  consumed_by: [],
  is_claim_check: false,
  compliance: "full",
  workflow_id: null,
  run_id: null,
  connector_id: null,
  cache_status: null,
  has_envelope: true,
  payload_action_name: null,
};

const SPAN: ChainSpanRow = {
  event_id: "evt-span-1",
  causation_id: null,
  kind_prefix: "channel",
  entity_id: "evt-1",
  started_at: "2026-07-01T00:00:00.000Z",
  completed_at: "2026-07-01T00:00:01.000Z",
  duration_ms: 1000,
};

describe("handleChainRequest", () => {
  it("returns 400 when tenant is missing (stubbed pool never called)", async () => {
    let called = false;
    const result = await handleChainRequest("corr-1", null, {
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
    const result = await handleChainRequest("corr-1", "  ", {
      queryEvents: async () => [],
      querySpans: async () => [],
    });
    expect(result.status).toBe(400);
  });

  it("returns 404 when the stubbed pool returns zero events", async () => {
    const result = await handleChainRequest("corr-1", "tenant-a", {
      queryEvents: async () => [],
      querySpans: async () => [],
    });
    expect(result.status).toBe(404);
  });

  it("routes the built queries to the injected pool and shapes a 200 response", async () => {
    const seenQueries: unknown[] = [];
    const result = await handleChainRequest("corr-1", "tenant-a", {
      queryEvents: async (query) => {
        seenQueries.push(query);
        expect(query.params).toEqual(["corr-1", "tenant-a"]);
        return [EVENT];
      },
      querySpans: async (query) => {
        seenQueries.push(query);
        expect(query.params).toEqual(["corr-1", "tenant-a"]);
        return [SPAN];
      },
    });

    expect(seenQueries.length).toBe(2);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.correlation_id).toBe("corr-1");
      expect(result.body.events).toEqual([EVENT]);
      expect(result.body.spans).toEqual([SPAN]);
      expect(result.body.summary.count).toBe(1);
    }
  });

  it("preserves millisecond precision and numeric duration_ms end-to-end when the injected pool returns raw driver rows (T02 defects 1+2, attempt 2 regression)", async () => {
    // Simulates what src/main.ts actually receives: `postgres` hands back
    // Date instances for timestamptz columns and a string for the view's
    // numeric duration_ms. The queryEvents/querySpans callbacks normalize
    // those raw rows before handleChainRequest ever sees them — exactly as
    // main.ts's fetch handler does.
    const rawEvents: readonly RawChainEventRow[] = [
      {
        ...EVENT,
        event_id: "evt-1",
        occurred_at: new Date("2026-07-11T15:38:33.726Z"),
      },
      {
        ...EVENT,
        event_id: "evt-2",
        occurred_at: new Date("2026-07-11T15:38:33.838Z"),
      },
    ];
    const rawSpans: readonly RawChainSpanRow[] = [
      {
        ...SPAN,
        started_at: new Date("2026-07-11T15:38:33.726Z"),
        completed_at: new Date("2026-07-11T15:38:33.838Z"),
        duration_ms: "112",
      },
    ];

    const result = await handleChainRequest("corr-1", "tenant-a", {
      queryEvents: async () => rawEvents.map(normalizeChainEventRow),
      querySpans: async () => rawSpans.map(normalizeChainSpanRow),
    });

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.summary.first_at).toBe("2026-07-11T15:38:33.726Z");
      expect(result.body.summary.last_at).toBe("2026-07-11T15:38:33.838Z");
      expect(result.body.summary.total_ms).toBe(112);
      expect(result.body.spans[0]?.duration_ms).toBe(112);
      expect(typeof result.body.spans[0]?.duration_ms).toBe("number");
    }
  });
});
