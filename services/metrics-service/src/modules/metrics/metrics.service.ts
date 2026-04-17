import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Msg, NatsConnection, Subscription } from "nats";
import { context as otelContext } from "@opentelemetry/api";
import {
  PinoLoggerService,
  logWithEnvelope,
  startNatsConsumerSpan,
} from "@yoizen/observability";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { TenantConnectionManager } from "@yoizen/database";
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
 * 8-token subject; metrics-service subscribes via Core NATS across
 * all tenants.
 */
const CANONICAL_METRICS_PATTERN =
  "evt.*.api-gateway.platform.events.gateway.metrics.v1";

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(MetricsService.name);
  private subscription: Subscription | null = null;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: TenantConnectionManager,
    private readonly metricsRepository: MetricsRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscription = this.nc.subscribe(CANONICAL_METRICS_PATTERN, {
      callback: (_err, msg) => {
        this.persistMessage(msg).catch((err) => {
          this.logger.warn(
            `metrics persist error: ${err instanceof Error ? err.message : err}`,
          );
        });
      },
    });
    this.logger.log(`Metrics subscribed to: ${CANONICAL_METRICS_PATTERN}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  private async persistMessage(msg: Msg): Promise<void> {
    const envelope = JSON.parse(
      new TextDecoder().decode(msg.data),
    ) as EventEnvelope;
    const { span, context: ctx } = startNatsConsumerSpan(
      "metrics-service",
      msg.subject,
      msg.headers ?? { keys: () => [], values: () => [], get: () => "", set: () => {} },
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
