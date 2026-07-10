// Time/size batching buffer for `TrackedEventRow` inserts (T07). Mimics
// services/usage-aggregator-service/src/modules/aggregator/batch-buffer.ts:
// `enqueue` returns a promise that resolves when the row's batch commits and
// rejects when it fails, so the consumer edge can ack on resolve / nak on
// reject WITHOUT this module knowing anything about NATS.
//
// Factory function + closures (NO class of our own — SPEC.md code-style
// contract). The only side effect is the injected `insert` sink; the buffer
// never throws for an expected failure — a failing insert rejects the waiters.

import type { InsertError, InsertOk } from "./insert-tracked-events.js";
import type { Result } from "./result.js";
import type { TrackedEventRow } from "./to-tracked-event-row.js";

export interface TrackedEventBuffer {
  /** Queues a row; resolves when its batch commits, rejects on insert failure. */
  enqueue(row: TrackedEventRow): Promise<void>;
  /** Drains buffered rows (shutdown). */
  stop(): Promise<void>;
}

export interface TrackedEventBufferOptions {
  /** Injected storage sink — normally `insertTrackedEvents` bound to a client. */
  readonly insert: (
    rows: readonly TrackedEventRow[]
  ) => Promise<Result<InsertOk, InsertError>>;
  /** Rows flushed together. @default 100 */
  readonly batchSize?: number;
  /** Max time a partial batch waits before flushing. @default 1000 ms */
  readonly batchFlushMs?: number;
  /** Optional line logger for verbose flush progress. */
  readonly log?: (message: string) => void;
  /**
   * Optional OTel span emitter (T2 of trace-visualization), called with the
   * flushed batch AFTER the Postgres insert commits. Fire-and-forget by
   * contract: the buffer NEVER awaits this before resolving the enqueue
   * waiters, and any rejection is caught + logged here — export failure MUST
   * NOT fail (or even delay) ingestion. Absent in tests/deployments that don't
   * wire span export (OTEL_EXPORT_ENABLED=false → `main.ts` passes a no-op).
   */
  readonly emitSpans?: (
    rows: readonly TrackedEventRow[]
  ) => Promise<unknown> | unknown;
}

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

/** Builds a batching buffer that coalesces rows into `insert` round trips. */
export function createTrackedEventBuffer(
  options: TrackedEventBufferOptions
): TrackedEventBuffer {
  const batchSize = options.batchSize ?? 100;
  const batchFlushMs = options.batchFlushMs ?? 1_000;
  const log = options.log ?? (() => {});

  let rows: TrackedEventRow[] = [];
  let waiters: Waiter[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const flush = async (): Promise<void> => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (rows.length === 0) {
      return;
    }

    const batch = rows;
    const batchWaiters = waiters;
    rows = [];
    waiters = [];

    log(`tracked-event-buffer: flushing ${batch.length} row(s)`);
    const result = await options.insert(batch);
    if (result.ok) {
      log(`tracked-event-buffer: committed ${result.value.inserted} row(s)`);
      // Span export is fire-and-forget: never awaited, never allowed to affect
      // the resolve below. Errors are caught + logged here — a Tempo/collector
      // outage must never surface as an ingestion failure.
      if (options.emitSpans) {
        try {
          Promise.resolve(options.emitSpans(batch)).catch((error: unknown) => {
            const reason =
              error instanceof Error ? error.message : String(error);
            log(`tracked-event-buffer: span emit FAILED (ignored) — ${reason}`);
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          log(`tracked-event-buffer: span emit FAILED (ignored) — ${reason}`);
        }
      }
      for (const w of batchWaiters) {
        w.resolve();
      }
      return;
    }

    log(`tracked-event-buffer: flush FAILED — ${result.error.reason}`);
    const error = new Error(result.error.reason);
    for (const w of batchWaiters) {
      w.reject(error);
    }
  };

  return {
    enqueue(row: TrackedEventRow): Promise<void> {
      if (stopped) {
        return Promise.reject(new Error("tracked-event-buffer stopped"));
      }
      return new Promise<void>((resolve, reject) => {
        rows.push(row);
        waiters.push({ resolve, reject });
        if (rows.length >= batchSize) {
          void flush();
          return;
        }
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            void flush();
          }, batchFlushMs);
          (flushTimer as { unref?: () => void }).unref?.();
        }
      });
    },
    async stop(): Promise<void> {
      stopped = true;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (rows.length > 0) {
        await flush();
      }
    },
  };
}
