import { PermanentError } from "@yoizen/shared";
import type { Consumer, JsMsg } from "nats";

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
  /**
   * Initial reattach delay (ms) used when the JetStream pull iterator
   * ends or throws. Exponentially backs off up to {@link reattachMaxDelayMs}
   * to avoid hammering NATS during a partial outage. @default 500
   */
  reattachInitialDelayMs?: number;
  /** Cap on the exponential reattach backoff (ms). @default 30_000 */
  reattachMaxDelayMs?: number;
  /**
   * When set, the runner calls `msg.working()` on this interval (ms)
   * while a handler is in flight, extending the server-side ack-wait
   * deadline without needing the full `ackWaitMs`/`backoffMs` window to
   * elapse. Opt-in and `undefined` by default — no behavior change for
   * consumers that don't set it. Useful for handlers whose runtime is
   * unpredictable relative to `ackWaitMs` (e.g. multi-minute LLM calls).
   */
  workingIntervalMs?: number;
}

export interface INatsConsumerLogger {
  error(message: string): void;
  warn?(message: string): void;
  log?(message: string): void;
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
  /**
   * Increments a counter every time the supervisor has to reattach the
   * pull iterator (i.e. the previous session ended unexpectedly). Lets
   * Prometheus alert on `rate(nats_consumer_reattach_total[5m]) > 0`.
   * Optional — runners predating this method are still supported.
   */
  recordReattach?(durable: string, reason: NatsReattachReason): void;
  /**
   * Increments the claim-check resolved counter.
   * Optional — runners without claim-check middleware are unaffected.
   */
  recordClaimCheckResolved?(durable: string): void;
  /**
   * Increments the claim-check resolution-failed counter.
   * `code` is one of the four `ClaimCheckErrorCode` values — bounded
   * Prometheus cardinality.
   * Optional.
   */
  recordClaimCheckResolveFailed?(durable: string, code: string): void;
}

/**
 * Why the supervisor had to reattach the pull iterator. Bounded set so
 * Prometheus cardinality stays flat.
 *
 * - `error`: `consumer.consume()` or the for-await iterator threw.
 * - `closed`: iterator returned `done: true` without yielding (NATS
 *   closed the long-poll cleanly — usually a server restart or idle
 *   timeout).
 */
export type NatsReattachReason = "error" | "closed";

/**
 * Optional callback invoked when a handler throws a `PermanentError`.
 * If set, the runner will call `onPermanent(msg, err)` and then
 * `msg.term()` the message instead of `msg.nak()`-ing it. Any error
 * thrown by the callback is logged at `error` level — the message is
 * still terminated to avoid a poison-pill retry storm.
 */
export type NatsPermanentHandler = (
  msg: JsMsg,
  err: PermanentError
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
 * Snapshot of the supervisor state, suitable for `/health` endpoints.
 * Returned by {@link NatsConsumerRunner.getState}. All fields are
 * O(1) reads (plain primitive access).
 *
 * `isHealthy` is derived: a started, non-stopped runner is healthy iff
 * it currently has a live pull iterator AND the last reattach (if any)
 * was attributable to a clean close, not an error.
 */
export interface INatsConsumerRunnerState {
  /** True between `start()` and `stop()`. */
  readonly running: boolean;
  /** True iff a pull iterator is currently bound. */
  readonly bound: boolean;
  /** Cumulative number of supervised reattach cycles since `start()`. */
  readonly reattachCount: number;
  /** Last reattach cause, if any. `null` while still on first session. */
  readonly lastReattachReason: NatsReattachReason | null;
  /** Wall-clock ms when the last reattach occurred. `null` if none. */
  readonly lastReattachAt: number | null;
  /** Wall-clock ms of the last successful message processing. */
  readonly lastMessageAt: number | null;
  /**
   * Aggregated liveness signal — `true` only when the runner is bound
   * AND the last session did not end with an error currently in
   * recovery. Health probes should consult this single field.
   */
  readonly isHealthy: boolean;
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
 * Iterator-level resilience:
 *   The supervisor wraps `consumer.consume()` in a reattach loop. If the
 *   NATS connection drops, heartbeats are missed, the durable is
 *   recreated, or the iterator otherwise ends, the runner logs the
 *   cause, waits with exponential backoff (capped), and re-binds a new
 *   pull iterator. Stays running until `stop()` is called.
 *
 *   Pre-supervisor versions of this class swallowed iterator errors in
 *   a bare `catch {}` and silently stopped consuming, leaving messages
 *   forever pending in the workqueue while the pod stayed `Ready` —
 *   exactly the failure mode that left tenant-service stuck in
 *   `provisioning_status: pending` despite a healthy pod (see PR
 *   description / RCA).
 *
 * @param consumer  JetStream `Consumer` (already resolved from durable name).
 * @param handler   Per-message callback; throw to nak, throw PermanentError to term.
 * @param logger    Must expose `.error()`; Nest `Logger` or Pino both work.
 * @param options   Optional batch-size / expiry / reattach overrides.
 * @param handlers  Optional DLQ / permanent-failure hook.
 */
export class NatsConsumerRunner {
  private consumeIterator: Awaited<ReturnType<Consumer["consume"]>> | null =
    null;

  private running = false;
  private stopped = false;
  /**
   * Monotonic counter incremented every time the supervisor opens a
   * fresh pull iterator. Used by `runSerial` / `runConcurrent` to bail
   * out promptly when `stop()` swaps the iterator from under them.
   */
  private generation = 0;
  private supervisorPromise: Promise<void> | null = null;

  // Observable state (cheap to read, plain primitives)
  private reattachCount = 0;
  private lastReattachReason: NatsReattachReason | null = null;
  private lastReattachAt: number | null = null;
  private lastMessageAt: number | null = null;
  private inErrorBackoff = false;

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
    private readonly durableName?: string
  ) {}

  private emit(result: NatsMessageResult, durationMs: number): void {
    if (!this.metrics || !this.durableName) {
      return;
    }
    try {
      this.metrics.recordProcessed(this.durableName, result);
      this.metrics.recordDuration(this.durableName, durationMs);
    } catch {
      // metrics are best-effort; never fail the consumer on emit errors
    }
  }

  private adjustInFlight(delta: number): void {
    if (!this.metrics || !this.durableName) {
      return;
    }
    try {
      this.metrics.adjustInFlight(this.durableName, delta);
    } catch {
      // ignore
    }
  }

  private emitReattach(reason: NatsReattachReason): void {
    if (!this.metrics || !this.durableName) {
      return;
    }
    if (typeof this.metrics.recordReattach !== "function") {
      return;
    }
    try {
      this.metrics.recordReattach(this.durableName, reason);
    } catch {
      // ignore
    }
  }

  /**
   * Begin consuming. Idempotent — extra calls after the first are
   * no-ops. Spawns the supervisor as a detached task; the returned
   * promise resolves as soon as the supervisor has been scheduled.
   */
  async start(): Promise<void> {
    if (this.running || this.stopped) {
      return;
    }
    this.running = true;
    this.supervisorPromise = this.supervise();
    // We deliberately do NOT await the supervisor — it runs for the
    // lifetime of the service. We only attach a tail handler so an
    // unhandled rejection in the supervisor itself can't crash the
    // process silently (defense-in-depth: the supervisor body is
    // already try/finally'd end-to-end).
    this.supervisorPromise.catch((err) => {
      this.logger.error(
        `NATS consumer supervisor exited with unhandled error (durable=${this.durableName ?? "<unnamed>"}): ${describeError(err)}`
      );
      this.running = false;
    });
  }

  /**
   * Gracefully stop the supervisor and the active iterator. Awaits the
   * supervisor task to ensure no in-flight handler is left mid-ack on
   * shutdown. Safe to call from `onModuleDestroy`.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    if (this.consumeIterator) {
      try {
        this.consumeIterator.stop();
      } catch {
        // already stopped or transport closed — nothing to do
      }
      this.consumeIterator = null;
    }
    const pending = this.supervisorPromise;
    this.supervisorPromise = null;
    if (pending) {
      try {
        await pending;
      } catch {
        // already logged inside supervise()
      }
    }
  }

  /**
   * Returns a snapshot of supervisor state. O(1). Designed for
   * `/health` controllers — the only surface used by Knative liveness.
   */
  getState(): INatsConsumerRunnerState {
    return {
      running: this.running,
      bound: this.consumeIterator !== null,
      reattachCount: this.reattachCount,
      lastReattachReason: this.lastReattachReason,
      lastReattachAt: this.lastReattachAt,
      lastMessageAt: this.lastMessageAt,
      isHealthy: this.computeHealthy(),
    };
  }

  /** Convenience accessor used by health controllers. */
  isHealthy(): boolean {
    return this.computeHealthy();
  }

  private computeHealthy(): boolean {
    if (this.stopped || !this.running) {
      return false;
    }
    if (this.consumeIterator === null) {
      return false;
    }
    return !this.inErrorBackoff;
  }

  /**
   * Long-running supervisor loop. Owns the `consumer.consume()` call
   * and re-binds the iterator on end/error with bounded exponential
   * backoff. Returns only after `stop()`.
   */
  private async supervise(): Promise<void> {
    const initialDelay = this.options.reattachInitialDelayMs ?? 500;
    const maxDelay = this.options.reattachMaxDelayMs ?? 30_000;
    let attempt = 0;

    while (!this.stopped) {
      let yieldedAny = false;
      let sessionError: unknown = null;

      try {
        this.consumeIterator = await this.consumer.consume({
          max_messages: this.options.maxMessages ?? 100,
          expires: this.options.expires ?? 30_000,
        });
        this.inErrorBackoff = false;
        // The session method drains the iterator to completion; it
        // returns true if at least one message was yielded so the
        // supervisor can distinguish "iterator just expired idle"
        // (no messages) from "session crashed mid-pull".
        yieldedAny = await this.runSession(this.generation + 1);
      } catch (err) {
        sessionError = err;
      }

      this.consumeIterator = null;
      this.generation++;

      if (this.stopped) {
        break;
      }

      const reason: NatsReattachReason = sessionError ? "error" : "closed";
      this.reattachCount++;
      this.lastReattachReason = reason;
      this.lastReattachAt = Date.now();
      this.emitReattach(reason);

      if (sessionError) {
        this.inErrorBackoff = true;
        attempt++;
        const delayMs = computeBackoffMs(attempt, initialDelay, maxDelay);
        this.logger.error(
          `NATS consumer iterator failed (durable=${this.durableName ?? "<unnamed>"}, attempt=${attempt}, yielded=${yieldedAny}): ${describeError(sessionError)} — reattaching in ${delayMs}ms`
        );
        await sleep(delayMs);
      } else {
        // Clean iterator close (server idle timeout or connection
        // recycled). Reset the error-backoff counter so a transient
        // hiccup followed by a clean close doesn't compound.
        attempt = 0;
        this.inErrorBackoff = false;
        if (this.logger.warn) {
          this.logger.warn(
            `NATS consumer iterator closed cleanly (durable=${this.durableName ?? "<unnamed>"}, yielded=${yieldedAny}) — rebinding`
          );
        }
        // Tiny pause to avoid a tight loop when consume() returns an
        // immediately-exhausted iterator (only happens in tests / when
        // the durable was deleted out from under us). 100ms is below
        // the human-noticeable threshold but lets event-loop microtasks
        // drain so other modules can also schedule work.
        await sleep(100);
      }
    }

    this.running = false;
  }

  /**
   * Drains a single pull-iterator session. Delegates to serial or
   * concurrent paths based on `concurrency`. Returns true iff at
   * least one message was yielded — the supervisor uses this to
   * differentiate clean idle expiry from connection-loss patterns.
   */
  private async runSession(generation: number): Promise<boolean> {
    this.generation = generation;
    const concurrency = Math.max(1, this.options.concurrency ?? 1);
    if (concurrency === 1) {
      return this.runSerial(generation);
    }
    return this.runConcurrent(concurrency, generation);
  }

  /** Serial path — preserves exact semantics for concurrency=1 consumers. */
  private async runSerial(generation: number): Promise<boolean> {
    let yieldedAny = false;
    const iter = this.consumeIterator;
    if (!iter) {
      return false;
    }
    for await (const msg of iter) {
      if (this.stopped || this.generation !== generation) {
        break;
      }
      yieldedAny = true;
      await this.processOne(msg);
    }
    return yieldedAny;
  }

  /**
   * Bounded-concurrency path. Keeps up to N handler invocations in
   * flight; when the active-set fills, awaits `Promise.race` to drain
   * one slot before pulling the next message. Ensures we always wait
   * for in-flight handlers on iterator shutdown so ack/nak is preserved.
   */
  private async runConcurrent(
    limit: number,
    generation: number
  ): Promise<boolean> {
    const active = new Set<Promise<void>>();
    let yieldedAny = false;
    const iter = this.consumeIterator;
    if (!iter) {
      return false;
    }
    try {
      for await (const msg of iter) {
        if (this.stopped || this.generation !== generation) {
          break;
        }
        yieldedAny = true;
        const slot = this.processOne(msg).finally(() => active.delete(slot));
        active.add(slot);
        if (active.size >= limit) {
          await Promise.race(active);
        }
      }
    } finally {
      if (active.size > 0) {
        await Promise.allSettled(active);
      }
    }
    return yieldedAny;
  }

  /**
   * Processes one message end-to-end: invokes the handler, acks/naks,
   * emits metrics, and never throws (errors are logged + naked).
   */
  private async processOne(msg: JsMsg): Promise<void> {
    const started = performance.now();
    this.adjustInFlight(1);
    const workingTimer = this.startWorkingTimer(msg);
    try {
      await this.handler(msg);
      msg.ack();
      this.emit("ack", performance.now() - started);
      this.lastMessageAt = Date.now();
    } catch (err) {
      if (err instanceof PermanentError) {
        await this.handlePermanent(msg, err);
        this.emit("term", performance.now() - started);
        this.lastMessageAt = Date.now();
        return;
      }
      this.logger.error(
        `Failed to process message: ${err instanceof Error ? err.message : String(err)}`
      );
      msg.nak();
      this.emit("nak", performance.now() - started);
      this.lastMessageAt = Date.now();
    } finally {
      this.adjustInFlight(-1);
      this.stopWorkingTimer(workingTimer);
    }
  }

  /**
   * Starts the optional in-progress ack extension for a single message.
   * Returns `null` (no-op) when `workingIntervalMs` is not configured —
   * zero overhead for every consumer that doesn't opt in.
   */
  private startWorkingTimer(msg: JsMsg): ReturnType<typeof setInterval> | null {
    const intervalMs = this.options.workingIntervalMs;
    if (!intervalMs || intervalMs <= 0) {
      return null;
    }
    const timer = setInterval(() => {
      try {
        msg.working();
      } catch {
        // Best-effort — extending the ack deadline should never crash
        // the handler or the consumer loop.
      }
    }, intervalMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    return timer;
  }

  private stopWorkingTimer(timer: ReturnType<typeof setInterval> | null): void {
    if (timer) {
      clearInterval(timer);
    }
  }

  private async handlePermanent(
    msg: JsMsg,
    err: PermanentError
  ): Promise<void> {
    this.logger.error(
      `Permanent failure [${err.stage}] on ${msg.subject}: ${err.reason}`
    );
    if (this.handlers.onPermanent) {
      try {
        await this.handlers.onPermanent(msg, err);
      } catch (dlqErr) {
        this.logger.error(
          `DLQ hook failed (still term-ing msg to avoid loop): ${dlqErr instanceof Error ? dlqErr.message : String(dlqErr)}`
        );
      }
    }
    msg.term();
  }
}

/**
 * Exponential backoff with hard cap. Pure function, O(1), zero
 * allocations. Doubling formula uses `Math.min` so the cap is honored
 * before the bit-shift can overflow.
 */
function computeBackoffMs(
  attempt: number,
  initialMs: number,
  maxMs: number
): number {
  // attempt is 1-based after the first failure
  const exp = Math.min(attempt - 1, 20);
  const raw = initialMs * 2 ** exp;
  return raw > maxMs ? maxMs : raw;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack
      ? `${err.message} | ${err.stack.split("\n")[1] ?? ""}`
      : err.message;
  }
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
