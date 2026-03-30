import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import type {
  IChannelProvider,
  ChannelAccount,
  InboundMessage,
  OutboundMessage,
  SendMessageResult,
} from "@yoizen/shared";
import { normalizeRecipient } from "@yoizen/shared";
import { tracedFetch } from "@yoizen/observability";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

@Injectable()
export class WhatsAppProvider implements IChannelProvider {
  readonly channel = "whatsapp" as const;
  readonly provider = "meta" as const;
  readonly signatureHeader = "x-hub-signature-256";

  private readonly logger = new Logger(WhatsAppProvider.name);

  parseWebhook(rawBody: Record<string, unknown>): InboundMessage[] {
    const messages: InboundMessage[] = [];
    const entry = rawBody.entry as Array<Record<string, unknown>> | undefined;
    if (!entry) return messages;

    for (const e of entry) {
      const changes = e.changes as Array<Record<string, unknown>> | undefined;
      if (!changes) continue;

      for (const change of changes) {
        const value = change.value as Record<string, unknown> | undefined;
        if (!value) continue;

        const msgs = value.messages as Array<Record<string, unknown>> | undefined;
        if (!msgs) continue;

        for (const msg of msgs) {
          const parsed = this.parseMessage(msg);
          if (parsed) messages.push(parsed);
        }
      }
    }

    return messages;
  }

  async sendMessage(
    account: ChannelAccount,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    const url = `${GRAPH_API_BASE}/${account.phoneNumberId}/messages`;
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
        this.logger.warn(`WhatsApp send failed: ${res.status} ${errorBody}`);
        return {
          success: false,
          error: `HTTP ${res.status}: ${errorBody}`,
          timestamp: new Date().toISOString(),
        };
      }

      const data = (await res.json()) as {
        messages?: Array<{ id: string }>;
      };

      return {
        success: true,
        providerMessageId: data.messages?.[0]?.id,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`WhatsApp send error: ${errorMsg}`);
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

  private parseMessage(
    msg: Record<string, unknown>,
  ): InboundMessage | null {
    const id = msg.id as string | undefined;
    const from = msg.from as string | undefined;
    const timestamp = msg.timestamp as string | undefined;
    const type = msg.type as string | undefined;

    if (!id || !from || !timestamp || !type) return null;

    const result: InboundMessage = {
      messageId: id,
      from: normalizeRecipient(from),
      timestamp,
      type,
      raw: msg,
    };

    if (type === "text") {
      const textObj = msg.text as { body?: string } | undefined;
      result.text = textObj?.body;
    }

    if (type === "image" || type === "video" || type === "audio" || type === "document") {
      const mediaObj = msg[type] as Record<string, unknown> | undefined;
      if (mediaObj) {
        result.media = {
          mimeType: (mediaObj.mime_type as string) ?? "application/octet-stream",
          id: mediaObj.id as string | undefined,
          caption: mediaObj.caption as string | undefined,
        };
      }
    }

    return result;
  }

  private buildSendPayload(
    message: OutboundMessage,
  ): Record<string, unknown> {
    const base: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: normalizeRecipient(message.to),
    };

    switch (message.type) {
      case "text":
        return {
          ...base,
          type: "text",
          text: { body: message.text },
        };

      case "template":
        return {
          ...base,
          type: "template",
          template: {
            name: message.templateName,
            language: { code: message.templateLanguage ?? "en" },
            ...(message.templateComponents && {
              components: message.templateComponents,
            }),
          },
        };

      case "image":
        return {
          ...base,
          type: "image",
          image: {
            link: message.mediaUrl,
            ...(message.caption && { caption: message.caption }),
          },
        };

      case "document":
        return {
          ...base,
          type: "document",
          document: {
            link: message.mediaUrl,
            ...(message.caption && { caption: message.caption }),
          },
        };

      default:
        return { ...base, type: "text", text: { body: message.text } };
    }
  }
}
