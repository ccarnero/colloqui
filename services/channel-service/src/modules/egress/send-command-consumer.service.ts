import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import type { NatsConnection, Subscription } from "nats";
import { PinoLoggerService } from "@yoizen/observability";
import {
  CHANNEL_SEND_SUBJECT_PATTERN,
  parseChannelSubject,
} from "@yoizen/shared";
import type { ChannelEnvelope, OutboundMessage } from "@yoizen/shared";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { EgressService } from "./egress.service";

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
    this.subscription = this.nc.subscribe(
      CHANNEL_SEND_SUBJECT_PATTERN,
      {
        callback: (_err, msg) => {
          this.handleMessage(msg).catch((err: unknown) => {
            this.logger.warn(
              `Send command handler error: ${err instanceof Error ? err.message : err}`,
            );
          });
        },
      },
    );

    this.logger.log(
      `Channel send consumer subscribed to: ${CHANNEL_SEND_SUBJECT_PATTERN}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  private async handleMessage(msg: {
    subject: string;
    data: Uint8Array;
  }): Promise<void> {
    const parsed = parseChannelSubject(msg.subject);
    if (!parsed) return;

    const decoder = new TextDecoder();
    const envelope = JSON.parse(
      decoder.decode(msg.data),
    ) as ChannelEnvelope;

    const { tenantId } = envelope;
    if (!tenantId) return;

    const data = envelope.data;
    const accountId = data.accountId as string | undefined;
    if (!accountId) {
      this.logger.warn("Send command missing accountId");
      return;
    }

    const outbound: OutboundMessage = {
      to: (data.to as string) ?? "",
      type:
        (data.type as OutboundMessage["type"]) ?? "text",
      text: data.text as string | undefined,
      templateName: data.templateName as string | undefined,
      templateLanguage:
        data.templateLanguage as string | undefined,
      templateComponents:
        data.templateComponents as
          | Record<string, unknown>[]
          | undefined,
      mediaUrl: data.mediaUrl as string | undefined,
      caption: data.caption as string | undefined,
    };

    const result = await this.egress.send(
      tenantId,
      accountId,
      outbound,
    );

    if (result.success) {
      this.logger.log(
        `Sent message to ${outbound.to} via ${accountId} for tenant ${tenantId}`,
      );
    } else {
      this.logger.warn(
        `Send failed for ${accountId}: ${result.error ?? "unknown"}`,
      );
    }
  }
}
