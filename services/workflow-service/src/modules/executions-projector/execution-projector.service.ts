import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import type { JetStreamClient, JetStreamManager, JsMsg } from "nats";
import {
  MultiTenantConsumerManager,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import {
  PinoLoggerService,
  createNatsConsumerMetrics,
} from "@yoizen/observability";
import type { EventEnvelope, JsonValue } from "@yoizen/shared";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../providers/providers.module";
import {
  ExecutionsProjectionRepository,
  type IExecutionStatusRow,
} from "./executions.repository";

const DURABLE_NAME = "workflow-projector";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
/** Canonical 8-token subject produced by `publishExecutionCompletedEvent`. */
const FILTER_SUBJECT =
  "evt.*.workflow-service.workflow.internal.native.execution_completed.v1";

/** Upper bound on the batch size to cap one SQL statement's cost. */
const MAX_BATCH_SIZE = 100;
/** Max time a message waits in the buffer before being flushed. */
const MAX_BATCH_WAIT_MS = 250;

interface IPendingItem {
  readonly msg: JsMsg;
  readonly row: IExecutionStatusRow;
  resolve: () => void;
  reject: (err: unknown) => void;
}

/**
 * Feature flag (defaults on) kept as an emergency kill-switch. When
 * `WORKFLOW_PROJECTOR_ENABLED=false` the service starts silently and
 * does not bind the consumer. The Temporal activity always emits the
 * event regardless — during a projector outage the messages sit in
 * JetStream and are drained when the flag is flipped back on.
 */
function isEnabled(): boolean {
  const v = process.env.WORKFLOW_PROJECTOR_ENABLED;
  if (v === undefined) return true;
  return v !== "false" && v !== "0";
}

/**
 * Consumes `workflow.execution.completed` canonical envelopes from
 * every `INGRESS-<tenant>` stream and projects terminal status into
 * the `workflow_executions` Postgres table.
 *
 * Decouples the Temporal worker from direct DB writes:
 *  - Worker emits one NATS message per finished workflow.
 *  - Projector batches up to `MAX_BATCH_SIZE` (or `MAX_BATCH_WAIT_MS`
 *    of queueing) and performs a single `UPDATE ... FROM (unnest(...))`
 *    roundtrip — so DB IOPS are decoupled from workflow throughput.
 *
 * Ack semantics:
 *  - Each message is ack'd only after its batch has been committed.
 *    If the SQL fails, messages are nak'd so JetStream redelivers
 *    them and we retry under the durable's `max_deliver` policy.
 *  - Same envelope re-delivered → `updated_at` just moves forward,
 *    `status` stays the same. Idempotent by construction.
 */
@Injectable()
export class ExecutionProjectorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PinoLoggerService(
    ExecutionProjectorService.name,
  );
  private manager: MultiTenantConsumerManager | null = null;
  private buffer: IPendingItem[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    private readonly repo: ExecutionsProjectionRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!isEnabled()) {
      this.logger.log(
        "ExecutionProjectorService disabled via WORKFLOW_PROJECTOR_ENABLED=false",
      );
      return;
    }

    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: FILTER_SUBJECT,
      description:
        "Projects workflow.execution.completed events to workflow_executions.status",
      metrics: createNatsConsumerMetrics("workflow-service"),
      /**
       * Handlers enqueue into a batch buffer and await the next flush
       * (size=100 or 250ms). Concurrency lets the buffer fill quickly
       * enough to hit size-triggered flushes instead of always waiting
       * the 250ms timer.
       */
      runnerOptions: { concurrency: 16 },
    };

    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.enqueue(msg),
      this.logger,
    );

    await this.manager.start();
    this.logger.log(
      `ExecutionProjectorService started durable='${DURABLE_NAME}' ` +
        `filter='${FILTER_SUBJECT}'`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length > 0) {
      await this.flush().catch((err) =>
        this.logger.warn(
          `Final flush on shutdown failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  /**
   * Handler invoked by the consumer runner for each JsMsg. Returns
   * a promise that only resolves after the message has been
   * successfully projected — this naturally back-pressures the
   * consumer runner and ensures at-least-once semantics.
   */
  private enqueue(msg: JsMsg): Promise<void> {
    const row = this.extractStatusRow(msg);
    if (!row) {
      /**
       * Unparseable or out-of-schema message: treat as non-retryable
       * and resolve so the runner ack's it. We don't route to DLQ
       * here because a garbled envelope at this subject is benign —
       * nothing to project.
       */
      this.logger.warn(
        `ExecutionProjector: dropping unparseable message subject=${msg.subject}`,
      );
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      this.buffer.push({ msg, row, resolve, reject });

      if (this.buffer.length >= MAX_BATCH_SIZE) {
        void this.flushNow();
      } else if (!this.flushTimer && !this.stopped) {
        this.flushTimer = setTimeout(() => {
          void this.flushNow();
        }, MAX_BATCH_WAIT_MS);
        (this.flushTimer as { unref?: () => void }).unref?.();
      }
    });
  }

  private flushNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    return this.flush();
  }

  /**
   * Drains the entire buffer, batches the UPDATE, and resolves
   * each pending handler-promise. On DB error, rejects every pending
   * promise so the runner NAKs the messages — JetStream will redeliver
   * under the durable's `max_deliver` policy.
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const items = this.buffer;
    this.buffer = [];

    const rows = new Array<IExecutionStatusRow>(items.length);
    for (let i = 0; i < items.length; i++) rows[i] = items[i]!.row;

    try {
      const affected = await this.repo.applyStatusBatch(rows);
      if (affected < items.length) {
        this.logger.warn(
          `ExecutionProjector: projected ${affected}/${items.length} — ` +
            `some executions not found in workflow_executions`,
        );
      }
      for (let i = 0; i < items.length; i++) items[i]!.resolve();
    } catch (err) {
      this.logger.error(
        `ExecutionProjector batch of ${items.length} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      for (let i = 0; i < items.length; i++) items[i]!.reject(err);
    }
  }

  /**
   * Parses an incoming NATS message into an update row.
   * Returns `null` when the envelope is malformed so the handler
   * can ack and move on.
   */
  private extractStatusRow(msg: JsMsg): IExecutionStatusRow | null {
    try {
      const envelope = JSON.parse(new TextDecoder().decode(msg.data)) as
        | EventEnvelope
        | null;
      if (!envelope || typeof envelope !== "object") return null;

      const payload = envelope.data?.payload as
        | Record<string, JsonValue>
        | undefined;
      if (!payload) return null;

      const id = payload["executionId"];
      const status = payload["status"];
      if (typeof id !== "string" || typeof status !== "string") return null;
      return { id, status };
    } catch {
      return null;
    }
  }
}
