import { Injectable } from "@nestjs/common";
import { createHash, timingSafeEqual } from "crypto";
import type {
  IChannelProvider,
  ChannelAccount,
  InboundMessage,
  OutboundMessage,
  SendMessageResult,
} from "@yoizen/shared";

@Injectable()
export class HttpProvider implements IChannelProvider {
  readonly channel = "http" as const;
  readonly provider = "http" as const;
  readonly signatureHeader = "x-http-channel-token";

  parseWebhook(rawBody: Record<string, unknown>): InboundMessage[] {
    const from = rawBody["from"];
    if (typeof from !== "string" || from === "") return [];

    const messageId =
      typeof rawBody["messageId"] === "string"
        ? rawBody["messageId"]
        : this.deriveMessageId(rawBody);

    const timestamp =
      typeof rawBody["timestamp"] === "string"
        ? rawBody["timestamp"]
        : String(Date.now());

    const type =
      typeof rawBody["type"] === "string" ? rawBody["type"] : "text";

    const raw =
      rawBody["raw"] !== undefined &&
      rawBody["raw"] !== null &&
      typeof rawBody["raw"] === "object" &&
      !Array.isArray(rawBody["raw"])
        ? (rawBody["raw"] as Record<string, unknown>)
        : rawBody;

    const msg: InboundMessage = {
      messageId,
      from,
      timestamp,
      type,
      raw,
    };

    if (typeof rawBody["text"] === "string") {
      msg.text = rawBody["text"];
    }

    return [msg];
  }

  verifySignature(
    _rawBody: Uint8Array,
    signature: string,
    secret: string,
  ): boolean {
    if (signature.length !== secret.length) return false;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(secret));
  }

  async sendMessage(
    _account: ChannelAccount,
    _message: OutboundMessage,
  ): Promise<SendMessageResult> {
    return {
      success: false,
      error: "outbound not supported for http channel",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Derives a deterministic dedup id from the request body when the caller
   * omits `messageId`. Only top-level keys are sorted — nested objects keep
   * their original key order, so callers sending nested payloads should
   * stabilize their key order or supply `messageId` explicitly.
   */
  private deriveMessageId(body: Record<string, unknown>): string {
    const sorted = JSON.stringify(
      Object.fromEntries(Object.keys(body).sort().map((k) => [k, body[k]])),
    );
    return createHash("sha1").update(sorted).digest("hex").slice(0, 16);
  }
}
