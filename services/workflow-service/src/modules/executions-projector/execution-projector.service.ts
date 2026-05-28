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
  isWorkerMode,
  resolveServiceName,
} from "@yoizen/observability";
import {
  parseSubject,
  type EventEnvelope,
  type JsonValue,
} from "@yoizen/shared";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../providers/providers.module";
import {
  EXECUTIONS_PROJECTION_REPOSITORY,
  type IExecutionStatusRow,
  type IExecutionsProjectionRepository,
} from "./executions.repository.interface";

const DURABLE_NAME = "workflow-projector";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
/** Canonical 8-token subject produced by `publishExecutionCompletedEvent`. */
const FILTER_SUBJECT =
  "evt.*.workflow-service.workflow.internal.native.execution_completed.v1";

/** Upper bound on per-tenant batch size to cap one SQL statement's cost. */
const MAX_BATCH_SIZE = 100;
/** Max time a message waits in the buffer before being flushed. */
const MAX_BATCH_WAIT_MS = 250;
/**
 * Hard cap on the total number of pending messages queued across all
 * tenants. Protects the service from unbounded memory growth when a
 * single flush cycle sees many different tenants at once.
 */
const TOTAL_MAX_BUFFER = 1_000;

interface IPendingItem {
  readonly msg: JsMsg;
  readonly row: IExecutionStatusRow;
  resolve: () => void;
  reject: (err: unknown) => void;
}

interface IExtractedRow {
  readonly tenantId: string;
  readonly row: IExecutionStatusRow;
}

function isEnabled(): boolean {
  const v = process.env.WORKFLOW_PROJECTOR_ENABLED;
  if (v === undefined) return true;
  return v !== "false" && v !== "0";
}

/**
 * Consumes `workflow.execution.completed` canonical envelopes from
 * every `INGRESS-<tenant>` stream and projects terminal status into
 * the `workflow_executions` table of that tenant's own Postgres
 * instance.
 *
 * Decouples the Temporal worker from direct DB writes:
 *  - Worker emits one NATS message per finished workflow.
 *  - Projector groups the buffer by `tenantId` (parsed from the
 *    subject) and performs a single `UPDATE ... FROM (unnest(...))`
 *    roundtrip per tenant — so DB IOPS are decoupled from workflow
 *    throughput while respecting the per-tenant DB isolation.
 *
 * Ack semantics:
 *  - Each message is ack'd only after its batch has been committed.
 *    If the SQL fails, messages are nak'd so JetStream redelivers
 *    them under the durable's `max_deliver` policy.
 *  - Same envelope re-delivered -> `updated_at` just moves forward,
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
  /**
   * Per-tenant pending buffers. A `Map` gives O(1) get/insert and
   * preserves insertion order for predictable flush fairness.
   */
  private buffers: Map<string, IPendingItem[]> = new Map();
  private pendingTotal = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    @Inject(EXECUTIONS_PROJECTION_REPOSITORY)
    private readonly repo: IExecutionsProjectionRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!isEnabled()) {
      this.logger.log(
        "ExecutionProjectorService disabled via WORKFLOW_PROJECTOR_ENABLED=false",
      );
      return;
    }

    const ensureOnly = !isWorkerMode();
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: FILTER_SUBJECT,
      description:
        "Projects workflow.execution.completed events to workflow_executions.status",
      metrics: createNatsConsumerMetrics(resolveServiceName("workflow-service")),
      runnerOptions: { concurrency: 16 },
      ensureOnly,
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
      ensureOnly
        ? `Pre-created '${DURABLE_NAME}' durable consumer (api mode, ensure-only)`
        : `ExecutionProjectorService started durable='${DURABLE_NAME}' filter='${FILTER_SUBJECT}'`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingTotal > 0) {
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
    const extracted = this.extractStatusRow(msg);
    if (!extracted) {
      this.logger.warn(
        `ExecutionProjector: dropping unparseable message subject=${msg.subject}`,
      );
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const item: IPendingItem = {
        msg,
        row: extracted.row,
        resolve,
        reject,
      };

      let bucket = this.buffers.get(extracted.tenantId);
      if (!bucket) {
        bucket = [];
        this.buffers.set(extracted.tenantId, bucket);
      }
      bucket.push(item);
      this.pendingTotal++;

      if (
        bucket.length >= MAX_BATCH_SIZE ||
        this.pendingTotal >= TOTAL_MAX_BUFFER
      ) {
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
   * Drains all per-tenant buffers, batches an UPDATE per tenant, and
   * resolves each pending handler-promise. On DB error for a tenant,
   * rejects every pending promise in that tenant's sub-batch so the
   * runner NAKs those messages — JetStream will redeliver under the
   * durable's `max_deliver` policy. Other tenants' sub-batches are
   * unaffected by a single tenant's DB failure.
   */
  private async flush(): Promise<void> {
    if (this.pendingTotal === 0) return;

    const snapshot = this.buffers;
    this.buffers = new Map();
    this.pendingTotal = 0;

    const tasks: Promise<void>[] = [];
    for (const [tenantId, items] of snapshot) {
      tasks.push(this.flushTenant(tenantId, items));
    }
    await Promise.all(tasks);
  }

  private async flushTenant(
    tenantId: string,
    items: IPendingItem[],
  ): Promise<void> {
    if (items.length === 0) return;

    const rows = new Array<IExecutionStatusRow>(items.length);
    for (let i = 0; i < items.length; i++) rows[i] = items[i]!.row;

    try {
      const affected = await this.repo.applyStatusBatch(tenantId, rows);
      if (affected < items.length) {
        this.logger.warn(
          `ExecutionProjector[${tenantId}]: projected ${affected}/${items.length} — ` +
            `some executions not found in workflow_executions`,
        );
      }
      for (let i = 0; i < items.length; i++) items[i]!.resolve();
    } catch (err) {
      this.logger.error(
        `ExecutionProjector[${tenantId}] batch of ${items.length} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      for (let i = 0; i < items.length; i++) items[i]!.reject(err);
    }
  }

  /**
   * Parses an incoming NATS message into an update row + tenantId.
   * Returns `null` when the envelope is malformed so the handler
   * can ack and move on.
   */
  private extractStatusRow(msg: JsMsg): IExtractedRow | null {
    try {
      const parsed = parseSubject(msg.subject);
      if (!parsed) return null;
      const tenantId = parsed.tenant;
      if (!tenantId) return null;

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
      return { tenantId, row: { id, status } };
    } catch {
      return null;
    }
  }
}
