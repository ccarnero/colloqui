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
  MultiTenantConsumerManager,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import {
  CHANNEL_AUDIT_SUBJECT_PATTERN,
  type ChannelEnvelope,
} from "@yoizen/shared";
import type { IStoredChannelEvent } from "../../common/channel-audit-projection";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../providers/nats.provider";
import {
  CHANNEL_AUDIT_REPOSITORY,
  type IChannelAuditQueryParams,
  type IChannelAuditRepository,
} from "./channel-audit.repository.interface";

export type { IStoredChannelEvent };

const DURABLE_NAME = "channel-audit";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
const HANDLER_CONCURRENCY = 16;

@Injectable()
export class ChannelAuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(ChannelAuditService.name);
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    @Inject(CHANNEL_AUDIT_REPOSITORY)
    private readonly channelAuditRepository: IChannelAuditRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const ensureOnly = !isWorkerMode();
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: CHANNEL_AUDIT_SUBJECT_PATTERN,
      description: "Channel messaging events audit writer",
      metrics: createNatsConsumerMetrics(resolveServiceName("audit-service")),
      runnerOptions: { concurrency: HANDLER_CONCURRENCY },
      ensureOnly,
    };
    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.handleJsMessage(msg),
      this.logger,
    );
    await this.manager.start();
    this.logger.log(
      ensureOnly
        ? `Pre-created '${DURABLE_NAME}' durable consumer (api mode, ensure-only)`
        : `Channel audit durable consumer ('${DURABLE_NAME}') started`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  private async handleJsMessage(msg: JsMsg): Promise<void> {
    const envelope = JSON.parse(
      new TextDecoder().decode(msg.data),
    ) as ChannelEnvelope;

    const incomingHeaders = msg.headers ?? {
      keys: () => [],
      values: () => [],
      get: () => "",
      set: () => {},
    };
    const { span, context: ctx } = startNatsConsumerSpan(
      resolveServiceName("audit-service"),
      msg.subject,
      incomingHeaders,
    );
    try {
      await otelContext.with(ctx, () =>
        this.persistChannelEnvelope(envelope, msg.subject),
      );
    } finally {
      span.end();
    }
  }

  private async persistChannelEnvelope(
    envelope: ChannelEnvelope,
    natsSubject: string,
  ): Promise<void> {
    const tenantId = envelope.tenant;
    if (!tenantId) {
      logWithEnvelope(
        this.logger,
        envelope,
        "channel-audit.dropped",
        "Dropping channel event: missing tenant",
        "warn",
      );
      return;
    }

    await this.channelAuditRepository.insertChannelEvent(envelope, natsSubject);
    logWithEnvelope(
      this.logger,
      envelope,
      "channel-audit.persist.ok",
      `Channel event persisted (subject=${natsSubject})`,
    );
  }

  async queryEvents(
    params: IChannelAuditQueryParams,
    tenantId: string,
  ): Promise<IStoredChannelEvent[]> {
    return this.channelAuditRepository.queryEvents(params, tenantId);
  }

  async getEventById(
    id: string,
    tenantId: string,
  ): Promise<IStoredChannelEvent | null> {
    return this.channelAuditRepository.getEventById(id, tenantId);
  }
}
