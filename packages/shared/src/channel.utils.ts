import {
  CHANNEL_SUBJECT_PREFIX,
  CHANNEL_PRODUCER,
  CHANNEL_DOMAIN,
  WEBHOOK_INGRESS_RECEIVED_KIND,
  WEBHOOK_INGRESS_RECEIVED_VERSION,
} from "./channel.constants";
import type { Channel, ChannelProvider, MessageKind } from "./channel.interfaces";

/**
 * Builds a NATS subject for channel messaging events (8 tokens — wdocs 02 §3).
 * Format:
 *   evt.<tenant>.channel-service.messaging.<channel>.<provider>.<kind>.v<version>
 */
export function buildChannelSubject(
  tenant: string,
  channel: Channel,
  provider: ChannelProvider,
  kind: MessageKind,
  version = "v1",
): string {
  return `${CHANNEL_SUBJECT_PREFIX}.${tenant}.${CHANNEL_PRODUCER}.${CHANNEL_DOMAIN}.${channel}.${provider}.${kind}.${version}`;
}

/**
 * Builds the stream name for a tenant's ingress messages.
 * Format: INGRESS-<tenant>
 */
export function buildIngressStreamName(tenant: string): string {
  return `INGRESS-${tenant}`;
}

/**
 * Builds the NATS Object Store bucket name for claim-check payloads.
 * Format: PAYLOAD-<tenant>
 */
export function buildClaimCheckBucket(tenant: string): string {
  return `PAYLOAD-${tenant}`;
}

/**
 * Builds a wildcard subject for subscribing to all messaging events
 * from a specific tenant (post producer token).
 * Format: evt.<tenant>.channel-service.messaging.>
 */
export function buildTenantWildcard(tenant: string): string {
  return `${CHANNEL_SUBJECT_PREFIX}.${tenant}.${CHANNEL_PRODUCER}.${CHANNEL_DOMAIN}.>`;
}

/**
 * Parses an 8-token channel subject into its components.
 * Returns null if the subject does not match the expected format.
 */
export function parseChannelSubject(subject: string): {
  tenant: string;
  producer: string;
  channel: Channel;
  provider: ChannelProvider;
  kind: MessageKind;
  version: string;
} | null {
  const parts = subject.split(".");
  if (parts.length !== 8) return null;
  if (parts[0] !== CHANNEL_SUBJECT_PREFIX) return null;
  if (parts[2] !== CHANNEL_PRODUCER) return null;
  if (parts[3] !== CHANNEL_DOMAIN) return null;

  return {
    tenant: parts[1],
    producer: parts[2],
    channel: parts[4] as Channel,
    provider: parts[5] as ChannelProvider,
    kind: parts[6] as MessageKind,
    version: parts[7],
  };
}

/**
 * Builds the webhook ingress subject used by api-gateway when forwarding
 * provider callbacks into JetStream.
 * Format:
 *   evt.<tenant>.api-gateway.messaging.<channel>.webhook.webhook_received.v1
 */
export function buildWebhookIngressSubject(
  tenant: string,
  channel: Channel,
): string {
  return `${CHANNEL_SUBJECT_PREFIX}.${tenant}.api-gateway.${CHANNEL_DOMAIN}.${channel}.webhook.${WEBHOOK_INGRESS_RECEIVED_KIND}.${WEBHOOK_INGRESS_RECEIVED_VERSION}`;
}

/**
 * Parses webhook ingress subjects produced by {@link buildWebhookIngressSubject}.
 * Returns null if the shape does not match the canonical 8-token format.
 */
export function parseWebhookIngressSubject(subject: string): {
  tenant: string;
  channel: Channel;
  producer: "api-gateway";
  domain: "messaging";
  provider: "webhook";
  kind: typeof WEBHOOK_INGRESS_RECEIVED_KIND;
  version: typeof WEBHOOK_INGRESS_RECEIVED_VERSION;
} | null {
  const parts = subject.split(".");
  if (parts.length !== 8) return null;
  if (parts[0] !== CHANNEL_SUBJECT_PREFIX) return null;
  if (parts[2] !== "api-gateway") return null;
  if (parts[3] !== CHANNEL_DOMAIN) return null;
  if (parts[5] !== "webhook") return null;
  if (parts[6] !== WEBHOOK_INGRESS_RECEIVED_KIND) return null;
  if (parts[7] !== WEBHOOK_INGRESS_RECEIVED_VERSION) return null;

  return {
    tenant: parts[1],
    channel: parts[4] as Channel,
    producer: "api-gateway",
    domain: "messaging",
    provider: "webhook",
    kind: WEBHOOK_INGRESS_RECEIVED_KIND,
    version: WEBHOOK_INGRESS_RECEIVED_VERSION,
  };
}
