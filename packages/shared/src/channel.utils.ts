import { CHANNEL_SUBJECT_PREFIX, CHANNEL_DOMAIN } from "./channel.constants";
import type { Channel, ChannelProvider, MessageKind } from "./channel.interfaces";

/**
 * Builds a NATS subject for channel messaging events.
 * Format: evt.<tenant>.messaging.<channel>.<provider>.<kind>.v1
 */
export function buildChannelSubject(
  tenant: string,
  channel: Channel,
  provider: ChannelProvider,
  kind: MessageKind,
  version = "v1",
): string {
  return `${CHANNEL_SUBJECT_PREFIX}.${tenant}.${CHANNEL_DOMAIN}.${channel}.${provider}.${kind}.${version}`;
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
 * Builds a wildcard subject for subscribing to all messages
 * from a specific tenant.
 * Format: evt.<tenant>.messaging.>
 */
export function buildTenantWildcard(tenant: string): string {
  return `${CHANNEL_SUBJECT_PREFIX}.${tenant}.${CHANNEL_DOMAIN}.>`;
}

/**
 * Parses a channel subject into its components.
 * Returns null if the subject does not match the expected format.
 */
export function parseChannelSubject(subject: string): {
  tenant: string;
  channel: Channel;
  provider: ChannelProvider;
  kind: MessageKind;
  version: string;
} | null {
  const parts = subject.split(".");
  if (parts.length !== 7) return null;
  if (parts[0] !== CHANNEL_SUBJECT_PREFIX) return null;
  if (parts[2] !== CHANNEL_DOMAIN) return null;

  return {
    tenant: parts[1],
    channel: parts[3] as Channel,
    provider: parts[4] as ChannelProvider,
    kind: parts[5] as MessageKind,
    version: parts[6],
  };
}
