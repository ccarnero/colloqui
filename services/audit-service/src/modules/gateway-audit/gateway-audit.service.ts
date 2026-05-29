import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Consumer } from "nats";
import { context as otelContext } from "@opentelemetry/api";
import { NatsConsumerRunner } from "@yoizen/database";
import {
  PinoLoggerService,
  startNatsConsumerSpan,
  createNatsConsumerMetrics,
  isWorkerMode,
  resolveServiceName,
} from "@yoizen/observability";
import type { AuditDashboardStats, GatewayAuditEvent } from "@yoizen/shared";
import type { IStoredGatewayAuditEvent } from "../../common/gateway-audit-projection";
import { GATEWAY_AUDIT_CONSUMER } from "../../providers/nats.provider";
import {
  GATEWAY_AUDIT_REPOSITORY,
  type IGatewayAuditQueryParams,
  type IGatewayAuditRepository,
} from "./gateway-audit.repository.interface";

export type { IStoredGatewayAuditEvent };

@Injectable()
export class GatewayAuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(GatewayAuditService.name);
  private readonly runner: NatsConsumerRunner;

  constructor(
    @Inject(GATEWAY_AUDIT_CONSUMER) consumer: Consumer,
    @Inject(GATEWAY_AUDIT_REPOSITORY)
    private readonly gatewayAuditRepository: IGatewayAuditRepository,
  ) {
    this.runner = new NatsConsumerRunner(
      consumer,
      (msg) => this.persistMessage(msg),
      this.logger,
      { concurrency: 16 },
      undefined,
      createNatsConsumerMetrics(resolveServiceName("audit-service")),
      "gateway-audit",
    );
  }

  async onModuleInit(): Promise<void> {
    if (!isWorkerMode()) {
      this.logger.log(
        `Skipping gateway-audit consumer in api mode (SERVICE_MODE=api)`,
      );
      return;
    }
    await this.runner.start();
  }

  async onModuleDestroy(): Promise<void> {
    if (!isWorkerMode()) return;
    await this.runner.stop();
  }

  private async persistMessage(msg: import("nats").JsMsg): Promise<void> {
    const event = msg.json() as GatewayAuditEvent;
    const tenantId = event.tenantId;
    if (!tenantId) return;

    const { span, context: ctx } = startNatsConsumerSpan(
      resolveServiceName("audit-service"),
      msg.subject,
      msg.headers ?? {
        keys: () => [],
        values: () => [],
        get: () => "",
        set: () => {},
      },
    );
    try {
      await otelContext.with(ctx, () =>
        this.gatewayAuditRepository.insertGatewayEvent(tenantId, event),
      );
    } finally {
      span.end();
    }
  }

  async queryEvents(
    params: IGatewayAuditQueryParams,
    tenantId: string,
  ): Promise<IStoredGatewayAuditEvent[]> {
    return this.gatewayAuditRepository.queryEvents(params, tenantId);
  }

  async getEventByRequestId(
    requestId: string,
    tenantId: string,
  ): Promise<IStoredGatewayAuditEvent | null> {
    return this.gatewayAuditRepository.getEventByRequestId(requestId, tenantId);
  }

  async getDashboardStats(tenantId: string): Promise<AuditDashboardStats> {
    return this.gatewayAuditRepository.getDashboardStats(tenantId);
  }
}
