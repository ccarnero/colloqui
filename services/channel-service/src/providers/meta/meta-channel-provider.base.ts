import type {
  ChannelAccount,
  InboundMessage,
  IChannelProvider,
  OutboundMessage,
  SendMessageResult,
} from "@yoizen/shared";
import { verifyWebhookSignature } from "./meta-base";

/**
 * Shared Meta (Facebook) webhook signature verification and provider metadata
 * for WhatsApp and Instagram channel implementations.
 */
export abstract class MetaChannelProviderBase implements IChannelProvider {
  readonly provider = "meta" as const;
  readonly signatureHeader = "x-hub-signature-256";

  abstract readonly channel: IChannelProvider["channel"];

  abstract parseWebhook(rawBody: Record<string, unknown>): InboundMessage[];

  abstract sendMessage(
    account: ChannelAccount,
    message: OutboundMessage,
  ): Promise<SendMessageResult>;

  verifySignature(
    rawBody: Uint8Array,
    signature: string,
    secret: string,
  ): boolean {
    return verifyWebhookSignature(Buffer.from(rawBody), signature, secret);
  }
}
