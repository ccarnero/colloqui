import { Injectable } from "@nestjs/common";
import type {
  ChannelAccount,
  IChannelProvider,
  InboundMessage,
  OutboundMessage,
  SendMessageResult,
} from "@yoizen/shared";
import { randomUUID } from "crypto";

/**
 * Outbound-only SINK channel, the mirror image of `HttpProvider`.
 *
 * `HttpProvider` is inbound-only: it parses webhooks and always FAILS the
 * send. This one is outbound-only: it always SUCCEEDS the send and accepts no
 * inbound traffic.
 *
 * WHY IT EXISTS. `EgressService` only publishes the `sent.v1` envelope inside
 * its `if (result.success)` branch — a provider failure records a metric and a
 * circuit-breaker failure and emits nothing. Before this provider, no channel
 * could reach that branch under test: `http` fails by design, and WhatsApp,
 * Instagram and Telegram all need live third-party credentials. So the entire
 * egress publish path was structurally untestable, which is exactly why
 * `tracking.tracked_events` held zero `sent` rows.
 *
 * WHAT IT DOES NOT DO. It is a sink: the message is accepted, counted as sent
 * and discarded — nothing is delivered anywhere. Every step AFTER the provider
 * returns (the `shadowPublish` envelope, the subject, the causal chain, the
 * breaker's success path) is the SAME code WhatsApp and Telegram run, so what
 * the suite exercises is the real egress path rather than a stand-in for it.
 * What it deliberately does NOT prove is third-party delivery.
 *
 * Its only consumer is `scripts/e2e/http-workflow.sh`'s `channelSend` stage.
 * Documented in DOCS/channels/channel-service.md's channel table.
 */
@Injectable()
export class E2eTestsProvider implements IChannelProvider {
  readonly channel = "e2e-tests" as const;
  readonly provider = "e2e-tests" as const;

  /**
   * Outbound-only: this channel has no webhook surface, so there is nothing to
   * parse. Returning `[]` matches how the ingress path already treats a body
   * it cannot turn into messages — it is dropped, not raised as an error.
   */
  parseWebhook(_rawBody: Record<string, unknown>): InboundMessage[] {
    return [];
  }

  /**
   * Outbound-only, so there is no legitimate inbound request to authenticate:
   * this ALWAYS denies. Returning `false` rather than `true` matters — a
   * permissive stub here would turn a test-only channel into an unauthenticated
   * ingress path on every deployment that ships it.
   */
  verifySignature(
    _rawBody: Uint8Array,
    _signature: string,
    _secret: string
  ): boolean {
    return false;
  }

  /**
   * Accepts and discards. `providerMessageId` is a fresh UUID rather than a
   * fixed literal so that two sends in the same run stay distinguishable in
   * the `sent.v1` envelopes an assertion reads back.
   */
  async sendMessage(
    _account: ChannelAccount,
    _message: OutboundMessage
  ): Promise<SendMessageResult> {
    return {
      success: true,
      providerMessageId: `e2e-${randomUUID()}`,
      timestamp: new Date().toISOString(),
    };
  }
}
