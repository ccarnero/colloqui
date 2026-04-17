import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import type { MsgHdrs, NatsConnection, Subscription } from "nats";
import { headers as natsHeaders } from "nats";
import {
  PinoLoggerService,
  logWithEnvelope,
  startNatsConsumerSpan,
} from "@yoizen/observability";
import {
  CHANNEL_SEND_SUBJECT_PATTERN,
  parseChannelSubject,
} from "@yoizen/shared";
import type { ChannelEnvelope, OutboundMessage } from "@yoizen/shared";
import { context as otelContext } from "@opentelemetry/api";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { EgressService } from "./egress.service";

interface INatsSubMessage {
  readonly subject: string;
  readonly data: Uint8Array;
  readonly headers?: MsgHdrs;
}

/**
 * Consumes `send` commands published by workflow activities
 * and delivers them through the EgressService.
 */
@Injectable()
export class SendCommandConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PinoLoggerService(
    SendCommandConsumerService.name,
  );
  private subscription: Subscription | null = null;

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly egress: EgressService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscription = this.nc.subscribe(CHANNEL_SEND_SUBJECT_PATTERN, {
      callback: (_err, msg) => {
        this.handleMessage(msg as INatsSubMessage).catch((err: unknown) => {
          this.logger.warn(
            `Send command handler error: ${err instanceof Error ? err.message : err}`,
          );
        });
      },
    });

    this.logger.log(
      `Channel send consumer subscribed to: ${CHANNEL_SEND_SUBJECT_PATTERN}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
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

    // Resume distributed trace from the publisher span.
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
        }
      });
    } finally {
      span.end();
    }
  }
}
