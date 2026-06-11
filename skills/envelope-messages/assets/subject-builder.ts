/**
 * Thin pointer to the canonical subject builders.
 *
 * Do NOT maintain subject-building logic here.
 * The as-built implementations live at:
 *
 *   packages/shared/src/channel.utils.ts
 *     - buildChannelSubject(tenant, channel, provider, kind, version?)
 *         → evt.<tenant>.channel-service.messaging.<channel>.<provider>.<kind>.v1
 *     - buildWebhookIngressSubject(tenant, channel)
 *         → evt.<tenant>.api-gateway.messaging.<channel>.webhook.webhook_received.v1
 *     - buildTenantWildcard(tenant)
 *         → evt.<tenant>.channel-service.messaging.>
 *     - parseChannelSubject(subject) → ParsedSubject | null
 *     - parseWebhookIngressSubject(subject) → parsed | null
 *
 *   packages/shared/src/envelope.utils.ts
 *     - buildSubject(params: BuildSubjectParams) — generic 8-token builder
 *
 * Key constants (packages/shared/src/channel.constants.ts):
 *   CHANNEL_PRODUCER                 = "channel-service"
 *   CHANNEL_STREAM_SUBJECTS_PATTERN  = "evt.*.channel-service.messaging.>"
 *   WEBHOOK_INGRESS_SUBJECT_FILTER   = "evt.*.api-gateway.messaging.*.webhook.webhook_received.v1"
 *
 * Subject format (8 tokens):
 *   evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>
 *
 * Examples:
 *   evt.acme.channel-service.messaging.whatsapp.meta.received.v1
 *   evt.acme.api-gateway.messaging.telegram.webhook.webhook_received.v1
 *   evt.acme.channel-service.messaging.whatsapp.meta.send.v1
 */

export {}; // Module marker — no runtime exports; see files referenced above.
