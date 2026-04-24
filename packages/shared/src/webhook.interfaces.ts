import type { Channel } from "./channel.interfaces";
import type { EventData, EventEnvelope } from "./interfaces";

export interface IWebhookVerifyRequest {
  tenantId: string;
  channel: Channel;
  verifyToken: string;
  challenge: string;
}

export type IWebhookVerifyResponse =
  | { ok: true; challenge: string }
  | { ok: false; reason: "invalid_token" | "unsupported_channel" | "bad_request" };

export interface IWebhookIngressData extends EventData {
  payload: Record<string, unknown>;
  raw_body_b64: string;
  headers: Record<string, string>;
}

/**
 * Pre-ingress envelope emitted by `api-gateway` as soon as a provider
 * webhook is received, **before** the signature is verified and the
 * request is mapped to a concrete account.
 *
 * Intentionally does **not** carry `accountid`: at this stage the
 * account is unknown, and using the tenant id as a placeholder
 * corrupts downstream aggregations (e.g. usage billing per account).
 * The `channel-service` webhook ingress consumer verifies the
 * signature, resolves the real account, and re-emits a canonical
 * `ChannelEnvelope` (with `accountid` populated) on the
 * `evt.<tenant>.channel-service.messaging.*` subject tree. Anything
 * that needs the account id MUST consume that downstream envelope.
 */
export type WebhookIngressEnvelope = Omit<EventEnvelope, "accountid"> & {
  producer: "api-gateway";
  domain: "messaging";
  provider: "webhook";
  channel: Channel;
  kind: "webhook_received";
  data: IWebhookIngressData;
};
