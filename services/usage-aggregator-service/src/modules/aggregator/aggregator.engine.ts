import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type {
  JetStreamClient,
  JetStreamManager,
  JsMsg,
  NatsConnection,
} from "nats";
import { PermanentError } from "@yoizen/shared";
import {
  MultiTenantConsumerManager,
  SharedTenantDatabaseMode,
  TenantConnectionManager,
  TenantMongoConnectionManager,
  type INatsConsumerLogger,
  NATS_CONNECTION,
} from "@yoizen/database";
import { PinoLoggerService, isWorkerMode } from "@yoizen/observability";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
} from "../../providers/nats.provider";
import { UsageTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { usageAggregatorServiceConfig } from "../../config";
import { BatchBuffer, type IBatchBufferHooks } from "./batch-buffer";
import {
  parseEnvelope,
  type IChannelEventRow,
} from "./envelope-parser";
import { aggregatorMetrics } from "./aggregator.metrics";

/**
 * Regexes driving `MultiTenantConsumerManager` reconciliation. The
 * ingress regex matches `INGRESS-<TENANT>` (uppercase suffix per
 * `getTenantStreamName`); DLQ matches `DLQ-<tenant>` (lowercase per
 * `buildDlqStreamName`).
 */
const INGRESS_STREAM_PATTERN = /^INGRESS-/;
const DLQ_STREAM_PATTERN = /^DLQ-/;

/**
 * Parse outcomes that are expected-and-boring: the aggregator acks
 * and moves on without logging an error. Kept as a `Set` so the
 * hot-path lookup is O(1) and future skip reasons just add an entry.
 */
const SKIP_REASONS = new Set<string>([
  "skipped-kind",
  "non-channel-subject",
  "non-channel-producer",
]);

/**
 * Drives the entire aggregator pipeline: discovers tenant streams
 * dynamically (via `MultiTenantConsumerManager`'s reconciliation
 * loop), consumes messages off each durable, parses them into
 * `IChannelEventRow`s, and flushes batches to the tenant's own
 * `mongo-usage` instance.
 *
 * Per-tenant batchers are keyed in a `Map` so enqueue → buffer is
 * O(1). Tenant discovery happens implicitly via stream discovery —
 * we never poll tenant-service because streams are the
 * authoritative runtime signal (no stream ⇒ no data ⇒ no buffer
 * needed).
 */
@Injectable()
export class AggregatorEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(AggregatorEngine.name);
  private readonly buffers = new Map<string, BatchBuffer>();
  private ingressManager: MultiTenantConsumerManager | null = null;
  private dlqManager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    @Inject(UsageTenantConnectionManager)
    private readonly usageConnections:
      | TenantConnectionManager
      | TenantMongoConnectionManager,
  ) {}

  async onModuleInit(): Promise<void> {
    const ensureOnly = !isWorkerMode();
    const cfg = usageAggregatorServiceConfig;
    const runnerLogger: INatsConsumerLogger & {
      log?: (m: string) => void;
      warn?: (m: string) => void;
    } = {
      error: (m) => this.logger.error(m),
      warn: (m) => this.logger.warn(m),
      log: (m) => this.logger.log(m),
    };

    this.ingressManager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      {
        streamPattern: INGRESS_STREAM_PATTERN,
        durableName: cfg.ingressDurableName,
        description: "usage-aggregator ingress/egress counter",
        maxAckPending: 1_000,
        dlq: { enabled: false },
        ensureOnly,
      },
      (msg) => this.handleMessage(msg, "ingress"),
      runnerLogger,
    );

    this.dlqManager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      {
        streamPattern: DLQ_STREAM_PATTERN,
        durableName: cfg.dlqDurableName,
        description: "usage-aggregator dlq counter",
        maxAckPending: 1_000,
        dlq: { enabled: false },
        ensureOnly,
      },
      (msg) => this.handleMessage(msg, "dlq"),
      runnerLogger,
    );

    await Promise.all([
      this.ingressManager.start(),
      this.dlqManager.start(),
    ]);

    this.logger.log(
      ensureOnly
        ? `Pre-created '${cfg.ingressDurableName}' + '${cfg.dlqDurableName}' durable consumers (api mode, ensure-only)`
        : "AggregatorEngine started: ingress + dlq durables reconciling tenant streams",
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.ingressManager?.stop(),
      this.dlqManager?.stop(),
    ]);
    if (!isWorkerMode()) return;
    const tasks: Promise<void>[] = [];
    for (const buf of this.buffers.values()) tasks.push(buf.stop());
    await Promise.allSettled(tasks);
    this.buffers.clear();
  }

  /**
   * Per-message entry point: parse → batch → `ack` only after commit.
   *
   * Permanent (non-retryable) failures bubble up as `PermanentError`
   * so the runner `msg.term()`s them; transient errors (Postgres
   * unavailability, batch commit failures) throw plain `Error` so
   * the runner `msg.nak()`s with backoff.
   */
  private async handleMessage(
    msg: JsMsg,
    streamKind: "ingress" | "dlq",
  ): Promise<void> {
    const streamName = msg.info.stream;
    const parse = parseEnvelope(msg.data, msg.subject, streamName);
    if (!parse.ok) {
      if (SKIP_REASONS.has(parse.reason)) {
        aggregatorMetrics.recordSkipped(parse.reason);
        return;
      }
      aggregatorMetrics.recordParseFailure(parse.reason);
      throw new PermanentError(
        "usage-aggregator.parse",
        `envelope rejected: ${parse.reason}`,
      );
    }

    const tenantId = extractTenantId(streamName, streamKind);
    if (!tenantId) {
      aggregatorMetrics.recordParseFailure("missing-tenant");
      throw new PermanentError(
        "usage-aggregator.tenant",
        `cannot derive tenant from stream '${streamName}'`,
      );
    }

    const buffer = await this.getBufferFor(tenantId);
    await buffer.enqueue(parse.row);
  }

  /**
   * Lazily builds the per-tenant `BatchBuffer` the first time we
   * see a message from that tenant. Connection + schema bootstrap
   * are delegated to `UsageTenantConnectionManager.ensureSchema`,
   * which dedupes concurrent cold starts internally.
   */
  private async getBufferFor(tenantId: string): Promise<BatchBuffer> {
    const cached = this.buffers.get(tenantId);
    if (cached) return cached;

    const target = await this.usageConnections.resolveDatabaseTarget(tenantId);
    const connection = await this.usageConnections.ensureSchema(tenantId);
    const sharedTenantId =
      target.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase
        ? tenantId
        : undefined;
    const hooks: IBatchBufferHooks = {
      onFlushSuccess: (rows, durationMs) =>
        this.recordFlushSuccess(tenantId, rows, durationMs),
      onFlushFailure: (rows, durationMs, err) =>
        this.recordFlushFailure(tenantId, rows, durationMs, err),
    };
    const buf = new BatchBuffer({
      connection,
      ...(sharedTenantId !== undefined && { tenantId: sharedTenantId }),
      batchSize: usageAggregatorServiceConfig.batchSize,
      batchFlushMs: usageAggregatorServiceConfig.batchFlushMs,
      hooks,
    });
    this.buffers.set(tenantId, buf);
    return buf;
  }

  private recordFlushSuccess(
    tenantId: string,
    rows: IChannelEventRow[],
    durationMs: number,
  ): void {
    const counts = countByDirection(rows);
    for (const [direction, count] of counts) {
      aggregatorMetrics.recordPersisted(tenantId, direction, count);
      aggregatorMetrics.recordBatchDurationMs(tenantId, direction, durationMs);
    }
    const latest = rows.reduce<number>(
      (acc, r) => Math.max(acc, r.ts.getTime()),
      0,
    );
    if (latest > 0) aggregatorMetrics.recordLastEventTs(tenantId, latest);
  }

  private recordFlushFailure(
    tenantId: string,
    rows: IChannelEventRow[],
    _durationMs: number,
    err: Error,
  ): void {
    aggregatorMetrics.recordInsertFailure(tenantId, rows.length);
    this.logger.error(
      `Usage flush failed for tenant ${tenantId} (${rows.length} rows): ${err.message}`,
    );
  }
}

/**
 * Reverses `getTenantStreamName` / `buildDlqStreamName` to recover
 * the tenant id. Stream names are the only reliable signal because
 * the envelope's `tenant` field is optional in older producers.
 */
function extractTenantId(
  streamName: string,
  streamKind: "ingress" | "dlq",
): string | null {
  if (streamKind === "ingress") {
    const suffix = streamName.replace(INGRESS_STREAM_PATTERN, "");
    return suffix.length > 0 ? suffix.toLowerCase() : null;
  }
  const suffix = streamName.replace(DLQ_STREAM_PATTERN, "");
  return suffix.length > 0 ? suffix : null;
}

/**
 * O(n) single-pass aggregation of row counts per direction. Uses a
 * `Map` to keep lookups amortized O(1). The resulting map will have
 * at most 3 entries (ingress/egress/dlq), so downstream metric
 * emission is effectively constant time.
 */
function countByDirection(
  rows: readonly IChannelEventRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const key = rows[i]!.direction;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
