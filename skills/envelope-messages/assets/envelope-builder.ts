/**
 * Thin pointer to the canonical envelope factory.
 *
 * Do NOT copy or maintain envelope-building logic here.
 * The as-built implementation lives at:
 *   services/channel-service/src/domain/envelope.factory.ts
 *     - createChannelEnvelope()   — inbound message envelope (kind: received/sent/…)
 *     - createChannelSentEnvelope() — outbound shadow envelope
 *
 * For generic (non-channel) envelopes use helpers from @yoizen/shared:
 *   packages/shared/src/envelope.utils.ts
 *     - buildEventEnvelope()  — fresh root envelope
 *     - deriveEnvelope()      — derived envelope preserving causal chain
 *
 * Key facts verified against the real code (envelope.factory.ts):
 *   - id: crypto.randomUUID()  (NOT ULID)
 *   - type: `io.yoizen.messaging.${channel}.${provider}.${kind}.v1`
 *   - source: `channel-service/accounts/${accountId}`
 *   - producer: CHANNEL_PRODUCER ("channel-service")
 *   - correlation_id: defaults to envelope id if not propagated
 *   - idempotencykey: computeIdempotencyKey(rawPayload) = sha256(canonicalJson(rawPayload))
 *   - payload_bytes: canonicalByteLength(rawPayload)  (UTF-8 bytes of canonical JSON)
 *   - payload_checksum: computePayloadChecksum(rawPayload) = sha256(canonicalJson(rawPayload))
 *
 * For the webhook pre-ingress envelope (kind: webhook_received) see:
 *   services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts
 *     - producer: "api-gateway"
 *     - type: `io.yoizen.messaging.${channel}.webhook.webhook_received.v1`
 *     - source: "api-gateway/webhooks"
 *     - accountid: OMITTED (unknown at this stage — resolved in stage 2)
 *     - data includes raw_body_b64 and filtered headers (WEBHOOK_FORWARDED_HEADERS — 7 entries;
 *       stage 2 additionally strips the WEBHOOK_SECRET_HEADERS subset post-verification)
 */

export {}; // Module marker — no runtime exports; see files referenced above.
