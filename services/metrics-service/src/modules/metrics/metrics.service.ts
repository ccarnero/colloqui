import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Consumer } from "nats";
import { NatsConsumerRunner } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { JETSTREAM_CLIENT } from "../../providers/nats.provider";
import { TenantConnectionManager } from "@yoizen/database";
import type { EventEnvelope } from "@yoizen/shared";
import type { IMetricsQueryParams } from "../../common/metrics-query-params";
import {
  MetricsRepository,
  type IMetricRecord,
} from "./metrics.repository";

export type { IMetricRecord };

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(MetricsService.name);
  private readonly runner: NatsConsumerRunner;

  constructor(
    @Inject(JETSTREAM_CLIENT) consumer: Consumer,
    private readonly tenantConnections: TenantConnectionManager,
    private readonly metricsRepository: MetricsRepository,
  ) {
    this.runner = new NatsConsumerRunner(
      consumer,
      (msg) => this.persistMessage(msg),
      this.logger,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.runner.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.runner.stop();
  }

  private async persistMessage(msg: import("nats").JsMsg): Promise<void> {
    await this.persistMetricEnvelope(msg.json() as EventEnvelope);
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
      this.logger.warn(`Dropping metric ${envelope.id}: missing tenant`);
      return;
    }

    const sql = this.tenantConnections.getConnection(tenantId);
    await this.metricsRepository.insertMetricFromEnvelope(
      sql,
      tenantId,
      envelope,
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
