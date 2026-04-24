import type { Sql } from "@yoizen/database";
import { insertBatch } from "./batch-inserter";
import type { IChannelEventRow } from "./envelope-parser";

/**
 * Hooks invoked on every flush — used by the engine to surface
 * metrics without coupling the buffer to any concrete sink.
 */
export interface IBatchBufferHooks {
  onFlushSuccess(rows: IChannelEventRow[], durationMs: number): void;
  onFlushFailure(
    rows: IChannelEventRow[],
    durationMs: number,
    error: Error,
  ): void;
}

export interface IBatchBufferOptions {
  readonly sql: Sql;
  /** Rows flushed together. @default 500 */
  readonly batchSize?: number;
  /** Max time a partial batch waits before flushing. @default 1000 ms */
  readonly batchFlushMs?: number;
  readonly hooks?: IBatchBufferHooks;
}

interface IEnqueuedWaiter {
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
}

/**
 * Coalesces per-tenant channel events into batched TimescaleDB
 * inserts, then resolves each caller's enqueue promise once the
 * batch commits so the NATS runner can ack **only** after durable
 * persistence — guaranteeing at-least-once + dedup-on-write.
 *
 * Complexity:
 *   - `enqueue`: O(1) amortized (push + timer arm).
 *   - `flush`:   O(n) on the flushed batch; single Postgres RPC.
 *
 * The buffer is intentionally *not* thread-safe across event-loop
 * ticks — Node is single-threaded and every operation either runs
 * synchronously or awaits inside this class's own methods.
 */
export class BatchBuffer {
  private rows: IChannelEventRow[] = [];
  private waiters: IEnqueuedWaiter[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly batchSize: number;
  private readonly batchFlushMs: number;
  private stopped = false;

  constructor(private readonly options: IBatchBufferOptions) {
    this.batchSize = options.batchSize ?? 500;
    this.batchFlushMs = options.batchFlushMs ?? 1_000;
  }

  /**
   * Queues a row and returns a promise that resolves when its batch
   * successfully commits — or rejects if the commit fails. Rejection
   * propagates back to the NATS runner which `nak`s for redelivery.
   */
  enqueue(row: IChannelEventRow): Promise<void> {
    if (this.stopped) {
      return Promise.reject(new Error("BatchBuffer stopped"));
    }
    return new Promise<void>((resolve, reject) => {
      this.rows.push(row);
      this.waiters.push({ resolve, reject });
      if (this.rows.length >= this.batchSize) {
        void this.flush();
        return;
      }
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          void this.flush();
        }, this.batchFlushMs);
      }
    });
  }

  /**
   * Drains all buffered rows. Callers should `await stop()` on
   * shutdown so in-flight NATS messages are either acked or naked
   * deterministically.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.rows.length > 0) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.rows.length === 0) return;

    const rows = this.rows;
    const waiters = this.waiters;
    this.rows = [];
    this.waiters = [];

    const started = performance.now();
    try {
      await insertBatch(this.options.sql, rows);
      const elapsed = performance.now() - started;
      this.options.hooks?.onFlushSuccess(rows, elapsed);
      for (let i = 0; i < waiters.length; i++) waiters[i]!.resolve();
    } catch (err) {
      const elapsed = performance.now() - started;
      const error = err instanceof Error ? err : new Error(String(err));
      this.options.hooks?.onFlushFailure(rows, elapsed, error);
      for (let i = 0; i < waiters.length; i++) waiters[i]!.reject(error);
    }
  }
}
