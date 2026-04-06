import { Injectable } from "@nestjs/common";
import type {
  ChannelAccount,
  InboundMessage,
  OutboundMessage,
  SendMessageResult,
} from "@yoizen/shared";
import { normalizeRecipient } from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { sendMetaMessage } from "../meta-base";
import { MetaChannelProviderBase } from "../meta-channel-provider.base";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

@Injectable()
export class WhatsAppProvider extends MetaChannelProviderBase {
  readonly channel = "whatsapp" as const;

  private readonly logger = new PinoLoggerService(WhatsAppProvider.name);

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

        const msgs = value.messages as
          | Array<Record<string, unknown>>
          | undefined;
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

    return sendMetaMessage({
      url,
      token: account.accessToken,
      body,
      logger: this.logger,
      logLabel: "WhatsApp",
      parseSuccessBody: (data: unknown) => {
        const d = data as { messages?: Array<{ id: string }> };
        return d.messages?.[0]?.id;
      },
    });
  }

  private parseMessage(msg: Record<string, unknown>): InboundMessage | null {
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

    if (
      type === "image" ||
      type === "video" ||
      type === "audio" ||
      type === "document"
    ) {
      const mediaObj = msg[type] as Record<string, unknown> | undefined;
      if (mediaObj) {
        result.media = {
          mimeType:
            (mediaObj.mime_type as string) ?? "application/octet-stream",
          id: mediaObj.id as string | undefined,
          caption: mediaObj.caption as string | undefined,
        };
      }
    }

    return result;
  }

  private buildSendPayload(message: OutboundMessage): Record<string, unknown> {
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
