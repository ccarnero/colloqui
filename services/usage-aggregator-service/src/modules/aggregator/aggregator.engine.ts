import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  type INatsConsumerLogger,
  MultiTenantConsumerManager,
  NATS_CONNECTION,
  SharedTenantDatabaseMode,
  type TenantConnectionManager,
  type TenantMongoConnectionManager,
} from "@yoizen/database";
import { isWorkerMode, PinoLoggerService } from "@yoizen/observability";
import { PermanentError } from "@yoizen/shared";
import type {
  JetStreamClient,
  JetStreamManager,
  JsMsg,
  NatsConnection,
} from "nats";
import { usageAggregatorServiceConfig } from "../../config";
import { JETSTREAM, JETSTREAM_MANAGER } from "../../providers/nats.provider";
import { UsageTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { aggregatorMetrics } from "./aggregator.metrics";
import { BatchBuffer, type IBatchBufferHooks } from "./batch-buffer";
import { insertConnectorCallBatch } from "./batch-inserter.connector";
import {
  CONNECTOR_SUBJECT_MARKER,
  type IChannelEventRow,
  type IConnectorCallEventRow,
  parseConnectorCallEnvelope,
  parseEnvelope,
} from "./envelope-parser";

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
  "non-connector-subject",
]);

/**
 * Minimal batch-buffer interface for connector events. Reuses the same
 * BatchBuffer class; the connection type is always Sql (Postgres-only).
 */
type ConnectorBatchBuffer = {
  enqueue(row: IConnectorCallEventRow): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Drives the entire aggregator pipeline: discovers tenant streams
 * dynamically (via `MultiTenantConsumerManager`'s reconciliation
 * loop), consumes messages off each durable, parses them into
 * `IChannelEventRow`s or `IConnectorCallEventRow`s, and flushes
 * batches to the tenant's own storage.
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
  private readonly connectorBuffers = new Map<string, ConnectorBatchBuffer>();
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
      runnerLogger
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
      runnerLogger
    );

    await Promise.all([this.ingressManager.start(), this.dlqManager.start()]);

    this.logger.log(
      ensureOnly
        ? `Pre-created '${cfg.ingressDurableName}' + '${cfg.dlqDurableName}' durable consumers (api mode, ensure-only)`
        : "AggregatorEngine started: ingress + dlq durables reconciling tenant streams"
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.ingressManager?.stop(), this.dlqManager?.stop()]);
    if (!isWorkerMode()) {
      return;
    }

    const channelTasks: Promise<void>[] = [];
    for (const buf of this.buffers.values()) {
      channelTasks.push(buf.stop());
    }

    const connectorTasks: Promise<void>[] = [];
    for (const buf of this.connectorBuffers.values()) {
      connectorTasks.push(buf.stop());
    }

    await Promise.allSettled([...channelTasks, ...connectorTasks]);
    this.buffers.clear();
    this.connectorBuffers.clear();
  }

  /**
   * Per-message entry point: parse → batch → `ack` only after commit.
   *
   * Connector call events are detected first by a cheap subject check
   * ({@link CONNECTOR_SUBJECT_MARKER}) before the channel path runs.
   *
   * Permanent (non-retryable) failures bubble up as `PermanentError`
   * so the runner `msg.term()`s them; transient errors (Postgres
   * unavailability, batch commit failures) throw plain `Error` so
   * the runner `msg.nak()`s with backoff.
   */
  private async handleMessage(
    msg: JsMsg,
    streamKind: "ingress" | "dlq"
  ): Promise<void> {
    const streamName = msg.info.stream;

    // Fast-path: connector call events — check subject before channel parse.
    if (msg.subject.includes(CONNECTOR_SUBJECT_MARKER)) {
      const parse = parseConnectorCallEnvelope(msg.data, msg.subject);
      if (!parse.ok) {
        if (SKIP_REASONS.has(parse.reason)) {
          aggregatorMetrics.recordSkipped(parse.reason);
          return;
        }
        aggregatorMetrics.recordParseFailure(parse.reason);
        throw new PermanentError(
          "usage-aggregator.connector.parse",
          `connector envelope rejected: ${parse.reason}`
        );
      }
      const tenantId = extractTenantId(streamName, streamKind);
      if (!tenantId) {
        aggregatorMetrics.recordParseFailure("missing-tenant");
        throw new PermanentError(
          "usage-aggregator.connector.tenant",
          `cannot derive tenant from stream '${streamName}'`
        );
      }
      const buffer = await this.getConnectorBufferFor(tenantId);
      await buffer.enqueue(parse.row);
      return;
    }

    // Channel event path (unchanged).
    const parse = parseEnvelope(msg.data, msg.subject, streamName);
    if (!parse.ok) {
      if (SKIP_REASONS.has(parse.reason)) {
        aggregatorMetrics.recordSkipped(parse.reason);
        return;
      }
      aggregatorMetrics.recordParseFailure(parse.reason);
      throw new PermanentError(
        "usage-aggregator.parse",
        `envelope rejected: ${parse.reason}`
      );
    }

    const tenantId = extractTenantId(streamName, streamKind);
    if (!tenantId) {
      aggregatorMetrics.recordParseFailure("missing-tenant");
      throw new PermanentError(
        "usage-aggregator.tenant",
        `cannot derive tenant from stream '${streamName}'`
      );
    }

    const buffer = await this.getBufferFor(tenantId);
    await buffer.enqueue(parse.row);
  }

  /**
   * Lazily builds the per-tenant channel `BatchBuffer` the first time we
   * see a message from that tenant.
   */
  private async getBufferFor(tenantId: string): Promise<BatchBuffer> {
    const cached = this.buffers.get(tenantId);
    if (cached) {
      return cached;
    }

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

  /**
   * Lazily builds the per-tenant connector `BatchBuffer` the first time we
   * see a connector call event from that tenant. Only works against the
   * Postgres (TimescaleDB) storage backend — connector events are not
   * mirrored to Mongo.
   */
  private async getConnectorBufferFor(
    tenantId: string
  ): Promise<ConnectorBatchBuffer> {
    const cached = this.connectorBuffers.get(tenantId);
    if (cached) {
      return cached;
    }

    const sql = await (
      this.usageConnections as TenantConnectionManager
    ).ensureSchema(tenantId);

    const rows: IConnectorCallEventRow[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const batchSize = usageAggregatorServiceConfig.batchSize;
    const batchFlushMs = usageAggregatorServiceConfig.batchFlushMs;

    const flush = async (): Promise<void> => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (rows.length === 0) {
        return;
      }
      const batch = rows.splice(0);
      try {
        await insertConnectorCallBatch(sql, batch, tenantId);
        this.logger.log(
          `Flushed ${batch.length} connector call events for tenant ${tenantId}`
        );
      } catch (err) {
        this.logger.error(
          `Connector flush failed for tenant ${tenantId} (${batch.length} rows): ${err instanceof Error ? err.message : String(err)}`
        );
        throw err;
      }
    };

    const buf: ConnectorBatchBuffer = {
      async enqueue(row: IConnectorCallEventRow): Promise<void> {
        rows.push(row);
        if (rows.length >= batchSize) {
          await flush();
          return;
        }
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            void flush();
          }, batchFlushMs);
        }
      },
      async stop(): Promise<void> {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        await flush();
      },
    };

    this.connectorBuffers.set(tenantId, buf);
    return buf;
  }

  private recordFlushSuccess(
    tenantId: string,
    rows: IChannelEventRow[],
    durationMs: number
  ): void {
    const counts = countByDirection(rows);
    for (const [direction, count] of counts) {
      aggregatorMetrics.recordPersisted(tenantId, direction, count);
      aggregatorMetrics.recordBatchDurationMs(tenantId, direction, durationMs);
    }
    const latest = rows.reduce<number>(
      (acc, r) => Math.max(acc, r.ts.getTime()),
      0
    );
    if (latest > 0) {
      aggregatorMetrics.recordLastEventTs(tenantId, latest);
    }
  }

  private recordFlushFailure(
    tenantId: string,
    rows: IChannelEventRow[],
    _durationMs: number,
    err: Error
  ): void {
    aggregatorMetrics.recordInsertFailure(tenantId, rows.length);
    this.logger.error(
      `Usage flush failed for tenant ${tenantId} (${rows.length} rows): ${err.message}`
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
  streamKind: "ingress" | "dlq"
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
  rows: readonly IChannelEventRow[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const key = rows[i]!.direction;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
