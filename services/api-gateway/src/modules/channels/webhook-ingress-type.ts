import {
  CHANNEL_DOMAIN,
  type Channel,
  WEBHOOK_INGRESS_RECEIVED_KIND,
  WEBHOOK_INGRESS_RECEIVED_VERSION,
} from "@yoizen/shared";

/**
 * Reverse-domain prefix every Yoizen event type carries
 * (`DOCS/messaging/envelope.md:77`).
 */
const EVENT_TYPE_PREFIX = "io.yoizen";

/**
 * Provider token for stage-1 receipts. The real provider (meta, telegram,
 * http) is only known after `channel-service` verifies the signature and
 * resolves the account, so stage 1 states the transport it actually used.
 * Same token the subject builder uses
 * (`packages/shared/src/channel.utils.ts:88`).
 */
const WEBHOOK_INGRESS_PROVIDER = "webhook";

/**
 * Builds the `type` field of a stage-1 `WebhookIngressEnvelope`.
 *
 * Format (`DOCS/messaging/envelope.md:77`):
 *   `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1`
 * Worked example: `DOCS/messaging/envelope.md:402` (§10.1) — quoted there
 * rather than here on purpose, see the note below.
 *
 * HISTORY (envelope-drift T05, SPEC decision 2): until 2026-07-31 the
 * publisher hardcoded ONE channel-less literal for EVERY channel — no
 * `<channel>` token, and `received` where the envelope's own `kind` says
 * `webhook_received`. The literal, the evidence and the impact are recorded
 * in `DRIFT.md` row 1; the migration guard lives in
 * `services/tracking-ingester-service/test/stage1-type-migration.spec.ts`.
 * That drift made `type` useless as a discriminator: consumers could not
 * recover the channel from it, nor separate a stage-1 receipt from a stage-2
 * `received`. Envelopes already in the tracking store keep the old value;
 * readers must accept both.
 *
 * The old and new literals are deliberately NOT spelled out in this file:
 * T05's accept gate greps `services/api-gateway/src` for them to prove the
 * hardcoded token is gone, and a quoted example in a comment would defeat
 * that check. Full strings live in the cited docs and in
 * `test/unit/webhook-ingress-type.spec.ts`.
 *
 * Pure and O(1): tokens come from the shared constants that also build the
 * subject, so the two can never drift apart.
 */
export function buildWebhookIngressType(channel: Channel): string {
  return (
    `${EVENT_TYPE_PREFIX}.${CHANNEL_DOMAIN}.${channel}.` +
    `${WEBHOOK_INGRESS_PROVIDER}.${WEBHOOK_INGRESS_RECEIVED_KIND}.` +
    `${WEBHOOK_INGRESS_RECEIVED_VERSION}`
  );
}
