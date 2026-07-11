// Tests for the `emitSpans` wiring added to `tracked-event-buffer.ts` (T2 of
// .sdd/changes/trace-visualization/tasks.md): after a successful Postgres
// insert, the flushed batch is handed to the injected span emitter — but the
// emitter is NEVER awaited before resolving `enqueue()`'s callers, and any
// rejection is swallowed (logged, not thrown/propagated).

import { describe, expect, it } from "bun:test";
import { ok } from "../src/lib/result.js";
import type { TrackedEventRow } from "../src/lib/to-tracked-event-row.js";
import { createTrackedEventBuffer } from "../src/lib/tracked-event-buffer.js";

function sampleRow(id: string): TrackedEventRow {
  return {
    event_id: id,
    subject:
      "evt.tenant-a.channel-service.messaging.telegram.telegram.received.v1",
    tenant: "tenant-a",
    producer: "channel-service",
    domain: "messaging",
    kind: "received",
    version: "v1",
    correlation_id: "corr-1",
    causation_id: null,
    causation_depth: 0,
    occurred_at: "2026-07-10T00:00:00.000Z",
    tech: "telegram",
    business_fn: "channel-processing",
    rule: 3,
    consumed_by: [],
    is_claim_check: false,
    envelope: {},
    compliance: "full",
    workflow_id: null,
    run_id: null,
    connector_id: null,
    cache_status: null,
    payload_status: "inline",
    payload_scrubbed_at: null,
  };
}

describe("createTrackedEventBuffer — emitSpans wiring (T2)", () => {
  it("calls emitSpans with the flushed batch AFTER a successful insert", async () => {
    const insertedBatches: TrackedEventRow[][] = [];
    const emittedBatches: TrackedEventRow[][] = [];

    const buffer = createTrackedEventBuffer({
      batchSize: 1,
      insert: async (rows) => {
        insertedBatches.push([...rows]);
        return ok({ inserted: rows.length });
      },
      emitSpans: async (rows) => {
        emittedBatches.push([...rows]);
      },
    });

    await buffer.enqueue(sampleRow("evt-1"));
    // Let the fire-and-forget emitSpans microtask settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(insertedBatches).toHaveLength(1);
    expect(emittedBatches).toHaveLength(1);
    expect(emittedBatches[0]?.[0]?.event_id).toBe("evt-1");
  });

  it("resolves enqueue() WITHOUT waiting for emitSpans to settle", async () => {
    let releaseEmit: (() => void) | undefined;
    const emitGate = new Promise<void>((resolve) => {
      releaseEmit = resolve;
    });
    let emitStarted = false;

    const buffer = createTrackedEventBuffer({
      batchSize: 1,
      insert: async (rows) => ok({ inserted: rows.length }),
      emitSpans: async () => {
        emitStarted = true;
        await emitGate;
      },
    });

    await buffer.enqueue(sampleRow("evt-1"));
    // enqueue() resolved even though emitGate is still pending.
    expect(emitStarted).toBe(true);
    releaseEmit?.();
  });

  it("a rejecting emitSpans is caught and logged — never thrown, never fails the insert", async () => {
    const logs: string[] = [];
    const buffer = createTrackedEventBuffer({
      batchSize: 1,
      log: (m) => logs.push(m),
      insert: async (rows) => ok({ inserted: rows.length }),
      emitSpans: async () => {
        throw new Error("ECONNREFUSED collector");
      },
    });

    // Must not throw/reject.
    await buffer.enqueue(sampleRow("evt-1"));
    await Promise.resolve();
    await Promise.resolve();

    expect(logs.some((l) => l.includes("ECONNREFUSED"))).toBe(true);
  });

  it("a synchronously-throwing emitSpans is also caught and logged", async () => {
    const logs: string[] = [];
    const buffer = createTrackedEventBuffer({
      batchSize: 1,
      log: (m) => logs.push(m),
      insert: async (rows) => ok({ inserted: rows.length }),
      emitSpans: () => {
        throw new Error("boom-sync");
      },
    });

    await buffer.enqueue(sampleRow("evt-1"));
    await Promise.resolve();

    expect(logs.some((l) => l.includes("boom-sync"))).toBe(true);
  });

  it("works with no emitSpans configured (backward compatible)", async () => {
    const buffer = createTrackedEventBuffer({
      batchSize: 1,
      insert: async (rows) => ok({ inserted: rows.length }),
    });
    await buffer.enqueue(sampleRow("evt-1"));
  });
});
