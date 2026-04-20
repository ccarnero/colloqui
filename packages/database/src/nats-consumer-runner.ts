import type { Consumer, JsMsg } from "nats";
import { PermanentError } from "@yoizen/shared";

export interface INatsConsumerRunnerOptions {
  /** Max messages per batch. @default 100 */
  maxMessages?: number;
  /** Idle expiry in ms before re-polling. @default 30_000 */
  expires?: number;
  /**
   * Maximum number of handler invocations running **concurrently** within
   * this runner. Defaults to `1` for backwards compatibility (serial
   * processing).
   *
   * Raise this for I/O-bound handlers (HTTP fetch, DB writes) so one
   * slow message cannot head-of-line-block the tenant's queue. Safe as
   * long as handlers are idempotent — which every consumer in this
   * platform already is (Nats-Msg-Id-based dedup + idempotent sinks).
   *
   * Bound by `max_ack_pending` on the server side: if set higher than
   * `max_ack_pending`, the server throttles deliveries first.
   */
  concurrency?: number;
}

export interface INatsConsumerLogger {
  error(message: string): void;
  warn?(message: string): void;
}

/**
 * Outcome of a single message handler execution, used by the metrics
 * sink to label counters/histograms so Prometheus can slice by durable.
 *
 * - `ack`: handler resolved → `msg.ack()`
 * - `nak`: handler threw a transient error → `msg.nak()` (will retry)
 * - `term`: handler threw `PermanentError` → `msg.term()` (no retry)
 */
export type NatsMessageResult = "ack" | "nak" | "term";

/**
 * Metrics sink consumed by {@link NatsConsumerRunner}. Implementations
 * typically back this with OpenTelemetry meters (see
 * `@yoizen/observability/createNatsConsumerMetrics`). The runner is
 * completely decoupled from any concrete metrics backend — this is
 * the only surface it uses.
 *
 * Label cardinality is kept bounded: only the **durable name** (fixed
 * set per deployment) and **result** (3 values) are used. No per-msg
 * or per-tenant labels are emitted from the runner to avoid explosion.
 *
 * All methods MUST be non-throwing / non-blocking — the runner calls
 * them from the hot path and cannot afford to stall the consumer loop
 * on metric emission failures.
 */
export interface INatsConsumerMetrics {
  /** Increments the processed-messages counter. */
  recordProcessed(durable: string, result: NatsMessageResult): void;
  /** Records the handler duration in milliseconds. */
  recordDuration(durable: string, ms: number): void;
  /** Adjusts the in-flight gauge (±1). */
  adjustInFlight(durable: string, delta: number): void;
}

/**
 * Optional callback invoked when a handler throws a `PermanentError`.
 * If set, the runner will call `onPermanent(msg, err)` and then
 * `msg.term()` the message instead of `msg.nak()`-ing it. Any error
 * thrown by the callback is logged at `error` level — the message is
 * still terminated to avoid a poison-pill retry storm.
 */
export type NatsPermanentHandler = (
  msg: JsMsg,
  err: PermanentError,
) => Promise<void>;

export interface INatsConsumerRunnerHandlers {
  /**
   * Called for DLQ routing on `PermanentError`. If omitted the runner
   * still `term()`s the message (no retry storm), but there's no DLQ
   * side-effect — use this to emit to `DLQ-<tenant>` or similar.
   */
  onPermanent?: NatsPermanentHandler;
}

/**
 * Encapsulates the JetStream pull-consumer lifecycle (start/stop)
 * and the for-await ack/nak loop used by every NATS-consuming service.
 *
 * Error taxonomy:
 *   - handler resolves             → `msg.ack()`
 *   - handler throws `Error`       → `msg.nak()` (retry w/ backoff)
 *   - handler throws `PermanentError` → `msg.term()` + optional DLQ hook
 *
 * @param consumer  JetStream `Consumer` (already resolved from durable name).
 * @param handler   Per-message callback; throw to nak, throw PermanentError to term.
 * @param logger    Must expose `.error()`; Nest `Logger` or Pino both work.
 * @param options   Optional batch-size / expiry overrides.
 * @param handlers  Optional DLQ / permanent-failure hook.
 */
export class NatsConsumerRunner {
  private consumeIterator: Awaited<
    ReturnType<Consumer["consume"]>
  > | null = null;

  constructor(
    private readonly consumer: Consumer,
    private readonly handler: (msg: JsMsg) => Promise<void>,
    private readonly logger: INatsConsumerLogger,
    private readonly options: INatsConsumerRunnerOptions = {},
    private readonly handlers: INatsConsumerRunnerHandlers = {},
    private readonly metrics?: INatsConsumerMetrics,
    /**
     * Durable name label applied to every metric. Required when
     * `metrics` is provided; ignored otherwise.
     */
    private readonly durableName?: string,
  ) {}

  private emit(result: NatsMessageResult, durationMs: number): void {
    if (!this.metrics || !this.durableName) return;
    try {
      this.metrics.recordProcessed(this.durableName, result);
      this.metrics.recordDuration(this.durableName, durationMs);
    } catch {
      // metrics are best-effort; never fail the consumer on emit errors
    }
  }

  private adjustInFlight(delta: number): void {
    if (!this.metrics || !this.durableName) return;
    try {
      this.metrics.adjustInFlight(this.durableName, delta);
    } catch {
      // ignore
    }
  }

  /** Begin consuming. Safe to call once in `onModuleInit`. */
  async start(): Promise<void> {
    this.consumeIterator = await this.consumer.consume({
      max_messages: this.options.maxMessages ?? 100,
      expires: this.options.expires ?? 30_000,
    });
    this.run();
  }

  /** Gracefully stop the iterator. Safe to call in `onModuleDestroy`. */
  async stop(): Promise<void> {
    if (this.consumeIterator) {
      this.consumeIterator.stop();
      this.consumeIterator = null;
    }
  }

  private async run(): Promise<void> {
    if (!this.consumeIterator) return;
    const concurrency = Math.max(1, this.options.concurrency ?? 1);
    if (concurrency === 1) {
      await this.runSerial();
      return;
    }
    await this.runConcurrent(concurrency);
  }

  /** Original path — preserves exact semantics for concurrency=1 consumers. */
  private async runSerial(): Promise<void> {
    try {
      for await (const msg of this.consumeIterator!) {
        await this.processOne(msg);
      }
    } catch {
      // iterator stopped
    }
  }

  /**
   * Bounded-concurrency path. Keeps up to N handler invocations in
   * flight; when the active-set fills, awaits `Promise.race` to drain
   * one slot before pulling the next message. Ensures we always wait
   * for in-flight handlers on iterator shutdown so ack/nak is preserved.
   */
  private async runConcurrent(limit: number): Promise<void> {
    const active = new Set<Promise<void>>();
    try {
      for await (const msg of this.consumeIterator!) {
        const slot = this.processOne(msg).finally(() => active.delete(slot));
        active.add(slot);
        if (active.size >= limit) {
          await Promise.race(active);
        }
      }
    } catch {
      // iterator stopped
    } finally {
      if (active.size > 0) {
        await Promise.allSettled(active);
      }
    }
  }

  /**
   * Processes one message end-to-end: invokes the handler, acks/naks,
   * emits metrics, and never throws (errors are logged + naked).
   */
  private async processOne(msg: JsMsg): Promise<void> {
    const started = performance.now();
    this.adjustInFlight(1);
    try {
      await this.handler(msg);
      msg.ack();
      this.emit("ack", performance.now() - started);
    } catch (err) {
      if (err instanceof PermanentError) {
        await this.handlePermanent(msg, err);
        this.emit("term", performance.now() - started);
        return;
      }
      this.logger.error(
        `Failed to process message: ${err instanceof Error ? err.message : String(err)}`,
      );
      msg.nak();
      this.emit("nak", performance.now() - started);
    } finally {
      this.adjustInFlight(-1);
    }
  }

  private async handlePermanent(
    msg: JsMsg,
    err: PermanentError,
  ): Promise<void> {
    this.logger.error(
      `Permanent failure [${err.stage}] on ${msg.subject}: ${err.reason}`,
    );
    if (this.handlers.onPermanent) {
      try {
        await this.handlers.onPermanent(msg, err);
      } catch (dlqErr) {
        this.logger.error(
          `DLQ hook failed (still term-ing msg to avoid loop): ${dlqErr instanceof Error ? dlqErr.message : String(dlqErr)}`,
        );
      }
    }
    msg.term();
  }
}
