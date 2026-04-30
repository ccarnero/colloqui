import { Injectable } from "@nestjs/common";
import { timingSafeEqual } from "crypto";
import type {
  IChannelProvider,
  ChannelAccount,
  InboundMessage,
  OutboundMessage,
  SendMessageResult,
} from "@yoizen/shared";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";

const BOT_API_BASE = "https://api.telegram.org/bot";

@Injectable()
export class TelegramProvider implements IChannelProvider {
  readonly channel = "telegram" as const;
  readonly provider = "telegram" as const;
  readonly signatureHeader = "x-telegram-bot-api-secret-token";

  private readonly logger = new PinoLoggerService(TelegramProvider.name);

  parseWebhook(rawBody: Record<string, unknown>): InboundMessage[] {
    const message = (rawBody.message ?? rawBody.channel_post) as
      | Record<string, unknown>
      | undefined;
    if (!message) return [];

    const parsed = this.parseTelegramMessage(message);
    return parsed ? [parsed] : [];
  }

  async sendMessage(
    account: ChannelAccount,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    const token = account.telegramBotToken ?? account.accessToken;

    try {
      switch (message.type) {
        case "image":
          return await this.sendPhoto(token, message);
        case "document":
          return await this.sendDocument(token, message);
        default:
          return await this.sendText(token, message);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Telegram send error: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      };
    }
  }

  verifySignature(
    _rawBody: Uint8Array,
    signature: string,
    secret: string,
  ): boolean {
    if (signature.length !== secret.length) return false;

    return timingSafeEqual(Buffer.from(signature), Buffer.from(secret));
  }

  /**
   * Registers (or updates) the Telegram webhook for a bot.
   * Must be called once after account creation / activation.
   */
  async registerWebhook(
    botToken: string,
    webhookUrl: string,
    secretToken: string,
  ): Promise<{ ok: boolean; description?: string }> {
    const url = `${BOT_API_BASE}${botToken}/setWebhook`;

    const res = await tracedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: ["message", "channel_post"],
        max_connections: 40,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await res.json()) as {
      ok: boolean;
      description?: string;
    };

    if (!data.ok) {
      this.logger.warn(`Telegram setWebhook failed: ${data.description}`);
    }

    return data;
  }

  private extractTextContent(
    msg: Record<string, unknown>,
    base: InboundMessage,
  ): InboundMessage | null {
    if (typeof msg.text !== "string") return null;
    return { ...base, text: msg.text };
  }

  private extractMediaContent(
    msg: Record<string, unknown>,
    base: InboundMessage,
  ): InboundMessage | null {
    const photo = msg.photo as
      | Array<{ file_id: string; file_unique_id: string }>
      | undefined;
    if (photo?.length) {
      const largest = photo[photo.length - 1];
      return {
        ...base,
        type: "image",
        text: msg.caption as string | undefined,
        media: {
          mimeType: "image/jpeg",
          id: largest.file_id,
          caption: msg.caption as string | undefined,
        },
      };
    }

    const document = msg.document as Record<string, unknown> | undefined;
    if (document) {
      return {
        ...base,
        type: "document",
        text: msg.caption as string | undefined,
        media: {
          mimeType:
            (document.mime_type as string) ?? "application/octet-stream",
          id: document.file_id as string | undefined,
          caption: msg.caption as string | undefined,
        },
      };
    }

    const sticker = msg.sticker as Record<string, unknown> | undefined;
    if (sticker) {
      return {
        ...base,
        type: "sticker",
        media: {
          mimeType: "image/webp",
          id: sticker.file_id as string | undefined,
        },
      };
    }

    const voice = msg.voice as Record<string, unknown> | undefined;
    if (voice) {
      return {
        ...base,
        type: "audio",
        media: {
          mimeType: (voice.mime_type as string) ?? "audio/ogg",
          id: voice.file_id as string | undefined,
        },
      };
    }

    const video = msg.video as Record<string, unknown> | undefined;
    if (video) {
      return {
        ...base,
        type: "video",
        text: msg.caption as string | undefined,
        media: {
          mimeType: (video.mime_type as string) ?? "video/mp4",
          id: video.file_id as string | undefined,
        },
      };
    }

    return null;
  }

  private parseTelegramMessage(
    msg: Record<string, unknown>,
  ): InboundMessage | null {
    const messageId = msg.message_id as number | undefined;
    const chat = msg.chat as { id?: number } | undefined;
    const from = msg.from as { id?: number } | undefined;
    const date = msg.date as number | undefined;

    if (!messageId || !date) return null;

    const senderId = String(from?.id ?? chat?.id ?? "");
    if (!senderId) return null;

    const base: InboundMessage = {
      messageId: String(messageId),
      from: senderId,
      timestamp: String(date),
      type: "text",
      raw: msg,
    };

    const textMsg = this.extractTextContent(msg, base);
    if (textMsg) return textMsg;

    const mediaMsg = this.extractMediaContent(msg, base);
    if (mediaMsg) return mediaMsg;

    return base;
  }

  private async sendText(
    token: string,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    const url = `${BOT_API_BASE}${token}/sendMessage`;

    const res = await tracedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: message.to,
        text: message.text ?? "",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    return this.handleResponse(res, "sendMessage");
  }

  private async sendPhoto(
    token: string,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    const url = `${BOT_API_BASE}${token}/sendPhoto`;

    const res = await tracedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: message.to,
        photo: message.mediaUrl,
        ...(message.caption && { caption: message.caption }),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    return this.handleResponse(res, "sendPhoto");
  }

  private async sendDocument(
    token: string,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    const url = `${BOT_API_BASE}${token}/sendDocument`;

    const res = await tracedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: message.to,
        document: message.mediaUrl,
        ...(message.caption && { caption: message.caption }),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    return this.handleResponse(res, "sendDocument");
  }

  private async handleResponse(
    res: Response,
    method: string,
  ): Promise<SendMessageResult> {
    if (!res.ok) {
      const errorBody = await res.text();
      this.logger.warn(`Telegram ${method} failed: ${res.status} ${errorBody}`);
      return {
        success: false,
        error: `HTTP ${res.status}: ${errorBody}`,
        timestamp: new Date().toISOString(),
      };
    }

    const data = (await res.json()) as {
      ok: boolean;
      result?: { message_id: number };
    };

    return {
      success: data.ok,
      providerMessageId:
        data.result?.message_id != null
          ? String(data.result.message_id)
          : undefined,
      timestamp: new Date().toISOString(),
    };
  }
}
