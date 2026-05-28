import type { Db } from "mongodb";
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
  readonly connection: Db | Sql;
  readonly tenantId?: string;
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

/** Coalesces per-tenant channel events into batched usage inserts. */
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

  /** Queues a row; resolves when its batch commits successfully. */
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

  /** Drains all buffered rows on shutdown. */
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
      await insertBatch(this.options.connection, rows, this.options.tenantId);
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
