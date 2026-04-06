import { Injectable } from "@nestjs/common";
import type {
  ChannelAccount,
  InboundMessage,
  OutboundMessage,
  SendMessageResult,
} from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { sendMetaMessage } from "../meta-base";
import { MetaChannelProviderBase } from "../meta-channel-provider.base";

const GRAPH_API_BASE = "https://graph.instagram.com/v21.0";

@Injectable()
export class InstagramProvider extends MetaChannelProviderBase {
  readonly channel = "instagram" as const;

  private readonly logger = new PinoLoggerService(InstagramProvider.name);

  parseWebhook(rawBody: Record<string, unknown>): InboundMessage[] {
    const messages: InboundMessage[] = [];
    const entry = rawBody.entry as Array<Record<string, unknown>> | undefined;
    if (!entry) return messages;

    for (const e of entry) {
      const messaging = e.messaging as
        | Array<Record<string, unknown>>
        | undefined;
      if (!messaging) continue;

      for (const event of messaging) {
        if (this.isEchoMessage(event)) continue;

        const parsed = this.parseInstagramMessage(event);
        if (parsed) messages.push(parsed);
      }
    }

    return messages;
  }

  async sendMessage(
    account: ChannelAccount,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    const url = `${GRAPH_API_BASE}/${account.igUserId}/messages`;
    const body = this.buildSendPayload(message);

    return sendMetaMessage({
      url,
      token: account.accessToken,
      body,
      logger: this.logger,
      logLabel: "Instagram",
      parseSuccessBody: (data: unknown) => {
        const d = data as { message_id?: string };
        return d.message_id;
      },
    });
  }

  private isEchoMessage(event: Record<string, unknown>): boolean {
    const message = event.message as Record<string, unknown> | undefined;
    return message?.is_echo === true;
  }

  private parseInstagramMessage(
    event: Record<string, unknown>,
  ): InboundMessage | null {
    const sender = event.sender as { id?: string } | undefined;
    const message = event.message as Record<string, unknown> | undefined;
    const timestamp = event.timestamp as number | undefined;

    if (!sender?.id || !message || !timestamp) return null;

    const mid = message.mid as string | undefined;
    if (!mid) return null;

    const result: InboundMessage = {
      messageId: mid,
      from: sender.id,
      timestamp: String(timestamp),
      type: "text",
      raw: event,
    };

    if (typeof message.text === "string") {
      result.text = message.text;
    }

    const attachments = message.attachments as
      | Array<{ type: string; payload: Record<string, unknown> }>
      | undefined;

    if (attachments?.length) {
      const attachment = attachments[0];
      result.type = attachment.type;
      result.media = {
        mimeType: "application/octet-stream",
        url: attachment.payload?.url as string | undefined,
      };
    }

    return result;
  }

  private buildSendPayload(message: OutboundMessage): Record<string, unknown> {
    const base: Record<string, unknown> = {
      recipient: { id: message.to },
    };

    switch (message.type) {
      case "text":
        return { ...base, message: { text: message.text } };

      case "image":
        return {
          ...base,
          message: {
            attachment: {
              type: "image",
              payload: { url: message.mediaUrl },
            },
          },
        };

      default:
        return { ...base, message: { text: message.text } };
    }
  }
}
