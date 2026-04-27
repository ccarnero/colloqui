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
} from "nats";
import { context as otelContext } from "@opentelemetry/api";
import {
  PinoLoggerService,
  logWithEnvelope,
  startNatsConsumerSpan,
  createNatsConsumerMetrics,
  isWorkerMode,
  resolveServiceName,
} from "@yoizen/observability";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../providers/nats.provider";
import {
  MultiTenantConsumerManager,
  TenantConnectionManager,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import type { EventEnvelope } from "@yoizen/shared";
import type { IMetricsQueryParams } from "../../common/metrics-query-params";
import {
  MetricsRepository,
  type IMetricRecord,
} from "./metrics.repository";

export type { IMetricRecord };

/**
 * Canonical metrics subject (wdocs 02 §9.2). Api-gateway publishes
 * metrics events into each `INGRESS-<tenant>` stream with this exact
 * 8-token subject; metrics-service consumes from a durable pull
 * consumer (queue-group: `metrics`) across every `INGRESS-<tenant>`
 * stream, keeping at-least-once semantics and per-group scale-out.
 */
const CANONICAL_METRICS_PATTERN =
  "evt.*.api-gateway.platform.events.gateway.metrics.v1";
const DURABLE_NAME = "metrics";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
/** Metric inserts are I/O-bound; parallel safe because each row is independent. */
const HANDLER_CONCURRENCY = 16;

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(MetricsService.name);
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    private readonly tenantConnections: TenantConnectionManager,
    private readonly metricsRepository: MetricsRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const ensureOnly = !isWorkerMode();
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: CANONICAL_METRICS_PATTERN,
      description: "Metrics persistence",
      metrics: createNatsConsumerMetrics(resolveServiceName("metrics-service")),
      runnerOptions: { concurrency: HANDLER_CONCURRENCY },
      ensureOnly,
    };
    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.persistJsMessage(msg),
      this.logger,
    );
    await this.manager.start();
    this.logger.log(
      ensureOnly
        ? `Pre-created '${DURABLE_NAME}' durable consumer (api mode, ensure-only)`
        : `Metrics durable consumer ('${DURABLE_NAME}') started`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  /** JetStream-path handler — throws on failure so runner NAKs. */
  private async persistJsMessage(msg: JsMsg): Promise<void> {
    const envelope = JSON.parse(
      new TextDecoder().decode(msg.data),
    ) as EventEnvelope;
    const { span, context: ctx } = startNatsConsumerSpan(
      resolveServiceName("metrics-service"),
      msg.subject,
      msg.headers ?? {
        keys: () => [],
        values: () => [],
        get: () => "",
        set: () => {},
      },
    );
    try {
      await otelContext.with(ctx, () => this.persistMetricEnvelope(envelope));
    } finally {
      span.end();
    }
  }

  /**
   * Exposes NATS persistence for unit tests (no live JetStream required).
   *
   * @param envelope  Decoded JetStream message body.
   */
  async persistMetricEnvelopeForTest(envelope: EventEnvelope): Promise<void> {
    await this.persistMetricEnvelope(envelope);
  }

  private async persistMetricEnvelope(envelope: EventEnvelope): Promise<void> {
    const tenantId = envelope.tenant;
    if (!tenantId) {
      logWithEnvelope(
        this.logger,
        envelope,
        "metrics.persist.dropped",
        "Dropping metric: missing tenant",
        "warn",
      );
      return;
    }

    const sql = this.tenantConnections.getConnection(tenantId);
    await this.metricsRepository.insertMetricFromEnvelope(
      sql,
      tenantId,
      envelope,
    );
    logWithEnvelope(
      this.logger,
      envelope,
      "metrics.persist.ok",
      "Metric persisted",
    );
  }

  /**
   * @param params  Query filters including source, name, date range, and pagination.
   * @param tenantId  Tenant scope for the query.
   * @returns Matching metric records ordered by creation date descending.
   */
  async queryMetrics(
    params: IMetricsQueryParams,
    tenantId: string,
  ): Promise<IMetricRecord[]> {
    const sql = this.tenantConnections.getConnection(tenantId);
    return this.metricsRepository.queryMetrics(sql, tenantId, params);
  }

  /**
   * @param id  Metric record primary key.
   * @param tenantId  Tenant scope for the lookup.
   * @returns The matching metric or `null`.
   */
  async getMetricById(
    id: string,
    tenantId: string,
  ): Promise<IMetricRecord | null> {
    const sql = this.tenantConnections.getConnection(tenantId);
    return this.metricsRepository.getMetricById(sql, tenantId, id);
  }
}
