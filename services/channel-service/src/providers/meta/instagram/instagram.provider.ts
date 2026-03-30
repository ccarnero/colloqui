import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import type {
  IChannelProvider,
  ChannelAccount,
  InboundMessage,
  OutboundMessage,
  SendMessageResult,
} from "@yoizen/shared";
import { tracedFetch } from "@yoizen/observability";

const GRAPH_API_BASE = "https://graph.instagram.com/v21.0";

@Injectable()
export class InstagramProvider implements IChannelProvider {
  readonly channel = "instagram" as const;
  readonly provider = "meta" as const;
  readonly signatureHeader = "x-hub-signature-256";

  private readonly logger = new Logger(InstagramProvider.name);

  parseWebhook(rawBody: Record<string, unknown>): InboundMessage[] {
    const messages: InboundMessage[] = [];
    const entry = rawBody.entry as Array<Record<string, unknown>> | undefined;
    if (!entry) return messages;

    for (const e of entry) {
      const messaging = e.messaging as Array<Record<string, unknown>> | undefined;
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

    try {
      const res = await tracedFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        this.logger.warn(`Instagram send failed: ${res.status} ${errorBody}`);
        return {
          success: false,
          error: `HTTP ${res.status}: ${errorBody}`,
          timestamp: new Date().toISOString(),
        };
      }

      const data = (await res.json()) as {
        recipient_id?: string;
        message_id?: string;
      };

      return {
        success: true,
        providerMessageId: data.message_id,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Instagram send error: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      };
    }
  }

  verifySignature(
    rawBody: Buffer,
    signature: string,
    secret: string,
  ): boolean {
    const expectedSig = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const expected = `sha256=${expectedSig}`;
    if (signature.length !== expected.length) return false;

    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
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

  private buildSendPayload(
    message: OutboundMessage,
  ): Record<string, unknown> {
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
