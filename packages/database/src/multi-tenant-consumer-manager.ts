import type {
  Consumer,
  JetStreamClient,
  JetStreamManager,
  JsMsg,
  ObjectStore,
} from "nats";
import { headers as natsHeaders } from "nats";
import {
  buildDlqMessageSubject,
  buildDlqStreamName,
  isCompliantEnvelope,
  PermanentError,
} from "@yoizen/shared";
import {
  NatsConsumerRunner,
  type INatsConsumerLogger,
  type INatsConsumerMetrics,
  type INatsConsumerRunnerOptions,
  type NatsPermanentHandler,
} from "./nats-consumer-runner";
import {
  ensureDurableConsumer,
  type IDurableConsumerOptions,
} from "./nats-durable-consumer";
import { ensureTenantDlqStream } from "./nats-dlq";
import {
  looksLikeClaimCheck,
  resolveClaimCheckEnvelope,
  withInflatedData,
} from "./claim-check";
import type { EventEnvelope } from "@yoizen/shared";

/**
 * Configuration for a multi-tenant durable consumer — one durable
 * exists per tenant stream and all durables share the same name so
 * that pods across replicas compete for deliveries on each stream.
 */
export interface IMultiTenantConsumerConfig {
  /** Regex matching the tenant stream names to bind to (`^INGRESS-.+$`). */
  readonly streamPattern: RegExp;
  /** Durable consumer name (same value across every tenant stream). */
  readonly durableName: string;
  /** Subject filter. Normally a cross-tenant wildcard like `evt.*.…`. */
  readonly filterSubject?: string;
  /** Subject filter list. Mutually exclusive with {@link filterSubject}. */
  readonly filterSubjects?: readonly string[];
  /** See {@link IDurableConsumerOptions.maxDeliver}. */
  readonly maxDeliver?: number;
  /** See {@link IDurableConsumerOptions.maxAckPending}. */
  readonly maxAckPending?: number;
  /** See {@link IDurableConsumerOptions.ackWaitMs}. */
  readonly ackWaitMs?: number;
  /** See {@link IDurableConsumerOptions.backoffMs}. */
  readonly backoffMs?: readonly number[];
  /** Description persisted on each durable for observability. */
  readonly description?: string;
  /** Reconcile interval (ms) to pick up newly created tenant streams. */
  readonly reconcileIntervalMs?: number;
  /** Runner-level tuning (batch size / pull expiry). */
  readonly runnerOptions?: INatsConsumerRunnerOptions;
  /**
   * Custom handler invoked when the inner handler throws a
   * `PermanentError`. If set, overrides the built-in tenant-DLQ router.
   */
  readonly onPermanent?: NatsPermanentHandler;
  /**
   * Built-in per-tenant DLQ routing. When enabled the manager ensures
   * `DLQ-<tenantId>` exists and republishes terminated envelopes to
   * `dlq.<tenantId>.<original-subject>` before `msg.term()`.
   *
   * Ignored if {@link onPermanent} is provided.
   */
  readonly dlq?: {
    /** `false` disables the built-in router. @default true */
    readonly enabled?: boolean;
    /**
     * Extracts the tenant id from a bound stream name. Defaults to
     * stripping the portion matched by `streamPattern` (e.g.
     * `INGRESS-acme` → `acme`).
     */
    readonly tenantFromStream?: (stream: string) => string | null;
  };
  /**
   * Optional metrics sink. Applied uniformly across every tenant
   * runner — the same durable name is used as label so Prometheus
   * rolls up across tenants naturally. No-op when unset.
   */
  readonly metrics?: INatsConsumerMetrics;
  /**
   * When `true`, only ensures the durable consumer exists on each
   * matching tenant stream and never starts a runner — no message is
   * consumed. Reconciliation still picks up new tenant streams so
   * they get their durable too.
   *
   * Use case (Phase 1.5): `*-api` pods run in `ensureOnly` mode so the
   * durable always exists and
   * `jetstream_consumer_num_pending{consumer_name="<durable>"}` stays
   * populated in Prometheus even when no `*-worker` is running yet.
   *
   * @default false
   */
  readonly ensureOnly?: boolean;
}

/**
 * How often the manager rescans `JetStreamManager.streams.list()` looking
 * for newly created tenant streams.
 *
 * A short interval matters because the **first message** into a freshly
 * created `INGRESS-<tenant>` can wait up to one full tick before any
 * consumer binds to it. We keep this at 5s so cold tenants start
 * draining within ~seconds; the only cost is one streams-list RPC per
 * tick, which is O(T) on total tenants (cheap: small T, cached JSAPI).
 */
const DEFAULT_RECONCILE_INTERVAL_MS = 5_000;

interface IRunnerEntry {
  readonly runner: NatsConsumerRunner;
  readonly consumer: Consumer;
}

/**
 * Lifecycle manager that keeps one durable pull consumer + runner
 * alive **per tenant stream** matched by {@link streamPattern}.
 *
 * Startup:
 *   1. List streams, filter by `streamPattern`.
 *   2. For each match, `ensureDurableConsumer` + start a runner.
 *
 * Runtime reconciliation (every `reconcileIntervalMs`):
 *   - Detects streams created after startup (new tenants) and binds
 *     them without needing a pod restart.
 *   - Never stops existing runners: tenant streams are long-lived and
 *     durables survive restarts on their own.
 *
 * All operations are O(T) on the set of tenant streams but each
 * per-tenant lookup is O(1) via a `Map<streamName, IRunnerEntry>`.
 */
export class MultiTenantConsumerManager {
  private readonly runners = new Map<string, IRunnerEntry>();
  /**
   * Streams whose durable consumer was ensured in `ensureOnly` mode.
   * Tracked separately from {@link runners} so reconciliation skips
   * already-handled streams in O(1) without spinning up runners.
   */
  private readonly ensuredStreams = new Set<string>();
  private reconcileHandle: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  /**
   * Lazy per-bucket Object Store cache for the claim-check middleware.
   * Open-only (no creation options) — the producer owns bucket creation.
   */
  private readonly claimCheckStores = new Map<string, ObjectStore>();

  constructor(
    private readonly jsm: JetStreamManager,
    private readonly js: JetStreamClient,
    private readonly config: IMultiTenantConsumerConfig,
    private readonly handler: (msg: JsMsg) => Promise<void>,
    private readonly logger: INatsConsumerLogger & {
      log?: (msg: string) => void;
      warn?: (msg: string) => void;
    },
  ) {}

  /**
   * Starts consumers on every matching stream that already exists and
   * schedules periodic reconciliation for new tenant streams.
   */
  async start(): Promise<void> {
    if (this.stopped) {
      throw new Error("MultiTenantConsumerManager: cannot start after stop()");
    }
    await this.reconcile();

    const interval =
      this.config.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
    this.reconcileHandle = setInterval(() => {
      this.reconcile().catch((err: unknown) => {
        this.logger.error(
          `MultiTenantConsumerManager reconcile failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, interval);
    if (typeof this.reconcileHandle === "object" && this.reconcileHandle) {
      (this.reconcileHandle as { unref?: () => void }).unref?.();
    }
  }

  /**
   * Stops every active runner and halts reconciliation. Safe to call
   * multiple times (idempotent). In `ensureOnly` mode there are no
   * runners to stop — only the reconcile interval is cleared.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconcileHandle) {
      clearInterval(this.reconcileHandle);
      this.reconcileHandle = null;
    }

    const entries = Array.from(this.runners.values());
    this.runners.clear();
    this.ensuredStreams.clear();
    await Promise.all(entries.map((e) => e.runner.stop()));
  }

  /** O(1) lookup of the active runner for a given stream (for tests). */
  getRunner(streamName: string): NatsConsumerRunner | undefined {
    return this.runners.get(streamName)?.runner;
  }

  /**
   * O(T) snapshot of bound stream names (for observability/tests).
   * Includes both runner-bound streams and ensure-only streams when
   * the manager runs in `ensureOnly` mode.
   */
  getBoundStreams(): string[] {
    if (this.config.ensureOnly === true) {
      return Array.from(this.ensuredStreams);
    }
    return Array.from(this.runners.keys());
  }

  private async listMatchingStreams(): Promise<string[]> {
    const names: string[] = [];
    const lister = this.jsm.streams.list();
    for await (const info of lister) {
      const name = info.config.name;
      if (this.config.streamPattern.test(name)) {
        names.push(name);
      }
    }
    return names;
  }

  private async reconcile(): Promise<void> {
    if (this.stopped) return;

    let streams: string[];
    try {
      streams = await this.listMatchingStreams();
    } catch (err: unknown) {
      this.logger.error(
        `Failed to list streams during reconcile: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const ensureOnly = this.config.ensureOnly === true;
    for (let i = 0; i < streams.length; i++) {
      const stream = streams[i]!;
      if (this.runners.has(stream)) continue;
      if (ensureOnly && this.ensuredStreams.has(stream)) continue;
      try {
        await this.bindStream(stream);
        this.logger.log?.(
          ensureOnly
            ? `Ensured durable '${this.config.durableName}' on stream '${stream}' (ensure-only)`
            : `Bound durable '${this.config.durableName}' on stream '${stream}'`,
        );
      } catch (err: unknown) {
        this.logger.error(
          `Failed to bind durable '${this.config.durableName}' on '${stream}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async bindStream(stream: string): Promise<void> {
    const opts: IDurableConsumerOptions = {
      stream,
      durableName: this.config.durableName,
      filterSubject: this.config.filterSubject,
      filterSubjects: this.config.filterSubjects,
      maxDeliver: this.config.maxDeliver,
      maxAckPending: this.config.maxAckPending,
      ackWaitMs: this.config.ackWaitMs,
      backoffMs: this.config.backoffMs,
      description: this.config.description,
    };

    await ensureDurableConsumer(this.jsm, opts);

    if (this.config.ensureOnly === true) {
      this.ensuredStreams.add(stream);
      return;
    }

    const consumer = await this.js.consumers.get(stream, this.config.durableName);
    const onPermanent = this.resolvePermanentHandler(stream);
    const runner = new NatsConsumerRunner(
      consumer,
      this.wrapHandler(this.handler),
      this.logger,
      this.config.runnerOptions,
      onPermanent ? { onPermanent } : {},
      this.config.metrics,
      this.config.durableName,
    );
    await runner.start();
    this.runners.set(stream, { runner, consumer });
  }

  /**
   * Lazy per-bucket Object Store accessor for the claim-check middleware.
   * Open-only (no creation options) — the producer owns bucket creation.
   */
  private async getClaimCheckStore(bucket: string): Promise<ObjectStore> {
    const cached = this.claimCheckStores.get(bucket);
    if (cached) return cached;
    const store = await this.js.views.os(bucket);
    this.claimCheckStores.set(bucket, store);
    return store;
  }

  /**
   * Wraps an inner handler with claim-check middleware.
   *
   * Flow:
   *   1. `!looksLikeClaimCheck(msg.data)` → call inner handler untouched.
   *   2. Parse JSON; on parse failure → passthrough.
   *   3. Guard `isCompliantEnvelope && payload_inline === false`, else passthrough.
   *   4. Resolve via `resolveClaimCheckEnvelope` → record metric → call inner
   *      handler with a Proxy that overrides `data` with the inflated bytes.
   *   5. On resolve error: record failed metric, re-throw (→ nak → backoff → DLQ).
   */
  private wrapHandler(
    inner: (msg: JsMsg) => Promise<void>,
  ): (msg: JsMsg) => Promise<void> {
    return async (msg: JsMsg): Promise<void> => {
      if (!looksLikeClaimCheck(msg.data)) {
        return inner(msg);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(msg.data).toString("utf8"));
      } catch {
        // Unparseable JSON — pass through byte-identical
        return inner(msg);
      }

      if (
        !isCompliantEnvelope(parsed) ||
        (parsed as EventEnvelope).data.payload_inline !== false
      ) {
        // Marker false-positive — pass through
        return inner(msg);
      }

      const envelope = parsed as EventEnvelope;
      try {
        const inflated = await resolveClaimCheckEnvelope(
          envelope,
          (bucket) => this.getClaimCheckStore(bucket),
        );
        if (
          this.config.metrics?.recordClaimCheckResolved &&
          this.config.durableName
        ) {
          try {
            this.config.metrics.recordClaimCheckResolved(
              this.config.durableName,
            );
          } catch {
            // metrics are best-effort
          }
        }
        const inflatedBytes = new TextEncoder().encode(
          JSON.stringify(inflated),
        );
        return inner(withInflatedData(msg, inflatedBytes));
      } catch (err) {
        if (
          this.config.metrics?.recordClaimCheckResolveFailed &&
          this.config.durableName
        ) {
          const code =
            err instanceof Error &&
            "code" in err &&
            typeof (err as { code: unknown }).code === "string"
              ? (err as { code: string }).code
              : "unknown";
          try {
            this.config.metrics.recordClaimCheckResolveFailed(
              this.config.durableName,
              code,
            );
          } catch {
            // metrics are best-effort
          }
        }
        throw err;
      }
    };
  }

  /**
   * Returns the permanent-failure handler to wire into the runner:
   *   1. Explicit `config.onPermanent` takes precedence.
   *   2. Otherwise (when `dlq.enabled` !== false) builds a per-tenant
   *      DLQ router bound to this stream's tenant.
   *   3. Returns `undefined` if DLQ is explicitly disabled.
   */
  private resolvePermanentHandler(
    stream: string,
  ): NatsPermanentHandler | undefined {
    if (this.config.onPermanent) return this.config.onPermanent;

    const dlqEnabled = this.config.dlq?.enabled ?? true;
    if (!dlqEnabled) return undefined;

    const tenantId = this.extractTenantId(stream);
    if (!tenantId) {
      this.logger.warn?.(
        `DLQ disabled for '${stream}': could not derive tenantId. ` +
          `Set config.dlq.tenantFromStream to override.`,
      );
      return undefined;
    }

    return this.buildTenantDlqHandler(tenantId);
  }

  private extractTenantId(stream: string): string | null {
    const custom = this.config.dlq?.tenantFromStream;
    if (custom) return custom(stream);
    const stripped = stream.replace(this.config.streamPattern, "");
    return stripped && stripped !== stream ? stripped : null;
  }

  /**
   * Publishes the terminated envelope into `DLQ-<tenant>` under
   * `dlq.<tenant>.<original-subject>` with extended metadata headers.
   * Any JetStream error is bubbled so the runner logs and still
   * `term()`s the message — DLQ loss is preferable to poison-pill
   * redelivery.
   */
  private buildTenantDlqHandler(tenantId: string): NatsPermanentHandler {
    const publisher = this.js;
    const jsm = this.jsm;

    return async (msg: JsMsg, err: PermanentError): Promise<void> => {
      await ensureTenantDlqStream(jsm, tenantId);

      const dlqSubject = buildDlqMessageSubject(tenantId, msg.subject);
      const hdrs = natsHeaders();
      hdrs.set("X-Dlq-Reason", err.reason);
      hdrs.set("X-Dlq-Stage", err.stage);
      hdrs.set("X-Dlq-Original-Subject", msg.subject);
      hdrs.set("X-Dlq-Stream", buildDlqStreamName(tenantId));
      hdrs.set("X-Dlq-Deliveries", String(msg.info.deliveryCount ?? 0));

      const origId = msg.headers?.get("Nats-Msg-Id");
      if (origId) hdrs.set("X-Dlq-Original-Msg-Id", origId);

      await publisher.publish(dlqSubject, msg.data, {
        headers: hdrs,
        msgID: origId
          ? `dlq:${origId}`
          : `dlq:${tenantId}:${msg.subject}:${msg.seq}`,
      });
    };
  }
}
