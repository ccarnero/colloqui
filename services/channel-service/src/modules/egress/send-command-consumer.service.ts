import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import type {
  JetStreamClient,
  JetStreamManager,
  JsMsg,
  MsgHdrs,
} from "nats";
import { headers as natsHeaders } from "nats";
import {
  PinoLoggerService,
  logWithEnvelope,
  startNatsConsumerSpan,
  createNatsConsumerMetrics,
} from "@yoizen/observability";
import {
  CHANNEL_SEND_SUBJECT_PATTERN,
  parseChannelSubject,
} from "@yoizen/shared";
import type { ChannelEnvelope, OutboundMessage } from "@yoizen/shared";
import {
  MultiTenantConsumerManager,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import { context as otelContext } from "@opentelemetry/api";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../providers/nats.provider";
import { EgressService } from "./egress.service";

const DURABLE_NAME = "channel-egress";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
/** Egress does HTTP calls to Telegram/WhatsApp providers — heavily I/O bound. */
const HANDLER_CONCURRENCY = 16;

/** Minimal shape shared between the JsMsg runner and the handler. */
interface INatsSubMessage {
  readonly subject: string;
  readonly data: Uint8Array;
  readonly headers?: MsgHdrs;
}

/**
 * Consumes `send` commands published by workflow activities and
 * delivers them through {@link EgressService}.
 *
 * Binds a JetStream durable pull consumer (`channel-egress`) per
 * tenant stream, with queue-group semantics — across N replicas of
 * `channel-service` only one replica consumes each message. This
 * eliminates the 5×duplication of outbound WhatsApp/Telegram
 * messages that `nc.subscribe` produced under multi-replica setups.
 */
@Injectable()
export class SendCommandConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PinoLoggerService(
    SendCommandConsumerService.name,
  );
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    private readonly egress: EgressService,
  ) {}

  async onModuleInit(): Promise<void> {
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: CHANNEL_SEND_SUBJECT_PATTERN,
      description: "Channel egress — outbound send commands",
      metrics: createNatsConsumerMetrics("channel-service"),
      runnerOptions: { concurrency: HANDLER_CONCURRENCY },
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
      `Channel egress durable consumer ('${DURABLE_NAME}') started`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  /**
   * JetStream-path handler: re-throws on failure so the runner can
   * nak the message and trigger redelivery with backoff.
   */
  private async handleJsMessage(msg: JsMsg): Promise<void> {
    await this.handleMessage({
      subject: msg.subject,
      data: msg.data,
      headers: msg.headers,
    });
  }

  private async handleMessage(msg: INatsSubMessage): Promise<void> {
    const parsed = parseChannelSubject(msg.subject);
    if (!parsed) return;

    const decoder = new TextDecoder();
    const envelope = JSON.parse(decoder.decode(msg.data)) as ChannelEnvelope;

    const tenantId = envelope.tenant;
    if (!tenantId) return;

    const source: Record<string, unknown> =
      (envelope.data?.payload as Record<string, unknown> | null | undefined) ??
      (envelope.data as unknown as Record<string, unknown>);
    const accountId =
      (source.accountId as string | undefined) ??
      (envelope.accountid as string | undefined);
    if (!accountId) {
      logWithEnvelope(
        this.logger,
        envelope,
        "egress.send_command.missing_account",
        "Send command missing accountId",
        "warn",
      );
      return;
    }

    const outbound: OutboundMessage = {
      to: (source.to as string) ?? "",
      type: (source.type as OutboundMessage["type"]) ?? "text",
      text: source.text as string | undefined,
      templateName: source.templateName as string | undefined,
      templateLanguage: source.templateLanguage as string | undefined,
      templateComponents: source.templateComponents as
        | Record<string, unknown>[]
        | undefined,
      mediaUrl: source.mediaUrl as string | undefined,
      caption: source.caption as string | undefined,
    };

    const incomingHeaders = msg.headers ?? natsHeaders();
    const { span, context: spanCtx } = startNatsConsumerSpan(
      "channel-service",
      msg.subject,
      incomingHeaders,
    );

    try {
      await otelContext.with(spanCtx, async () => {
        const result = await this.egress.send(tenantId, accountId, outbound, {
          causationId: envelope.id ?? null,
          correlationId: envelope.correlation_id ?? undefined,
          incomingDepth: envelope.transport?.depth ?? 0,
        });

        if (result.success) {
          logWithEnvelope(
            this.logger,
            envelope,
            "egress.send_command.sent",
            `Sent message to ${outbound.to} via ${accountId}`,
          );
        } else {
          logWithEnvelope(
            this.logger,
            envelope,
            "egress.send_command.failed",
            `Send failed for ${accountId}: ${result.error ?? "unknown"}`,
            "warn",
          );
          throw new Error(result.error ?? "egress send failed");
        }
      });
    } finally {
      span.end();
    }
  }
}

