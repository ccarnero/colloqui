export const CHANNEL_STREAM_PREFIX = "INGRESS";
/**
 * Canonical 8-token subject pattern for the messaging domain:
 * `evt.<tenant>.channel-service.messaging.>`.
 * Matches events published by channel-service (ingress, egress shadow,
 * workflow-service channel-send).
 */
export const CHANNEL_STREAM_SUBJECTS_PATTERN =
  "evt.*.channel-service.messaging.>" as const;
export const CHANNEL_CONSUMER_NAME = "channel-processor";

export const CHANNEL_SUBJECT_PREFIX = "evt";
/** Producer token (§3 of DOCS/messaging/envelope.md). */
export const CHANNEL_PRODUCER = "channel-service";
export const CHANNEL_DOMAIN = "messaging";

export const CHANNEL_STREAM_MAX_AGE_NS = 7 * 24 * 60 * 60 * 1_000_000_000;
export const CHANNEL_STREAM_MAX_BYTES = 256 * 1024 * 1024;
export const CHANNEL_MAX_DELIVER = 5;

export const CLAIM_CHECK_THRESHOLD_BYTES = 256 * 1024;
export const CLAIM_CHECK_BUCKET_PREFIX = "PAYLOAD";
/** Object Store TTL aligned to stream max_age (DOCS/messaging/claim-check.md §4.2). Already in nanoseconds — pass directly as `ttl`. */
export const CLAIM_CHECK_BUCKET_TTL_NS = CHANNEL_STREAM_MAX_AGE_NS;
/** Maximum bytes per tenant claim-check bucket (same magnitude as DLQ_TENANT_STREAM_MAX_BYTES). */
export const CLAIM_CHECK_BUCKET_MAX_BYTES = 512 * 1024 * 1024;

export const CHANNEL_AUDIT_SUBJECT_PATTERN =
  "evt.*.channel-service.messaging.>" as const;

/**
 * Send-command subject pattern. Matches 8-token canonical:
 * `evt.<tenant>.channel-service.messaging.<channel>.<provider>.send.v1`.
 */
export const CHANNEL_SEND_SUBJECT_PATTERN =
  "evt.*.channel-service.messaging.*.*.send.v1" as const;

/**
 * Canonical webhook ingress subject:
 * `evt.<tenant>.api-gateway.messaging.<channel>.webhook.webhook_received.v1`.
 */
export const WEBHOOK_INGRESS_RECEIVED_KIND = "webhook_received" as const;
export const WEBHOOK_INGRESS_RECEIVED_VERSION = "v1" as const;
export const WEBHOOK_INGRESS_SUBJECT_FILTER =
  "evt.*.api-gateway.messaging.*.webhook.webhook_received.v1" as const;

/**
 * Allowlist of webhook headers forwarded through the ingress envelope.
 * Every entry is either a surviving provider's `signatureHeader`
 * (`WEBHOOK_SECRET_HEADERS`) or a diagnostic header; nothing else crosses
 * the bridge. Documented in `DOCS/messaging/envelope.md` §4.1 and pinned by
 * `src/__tests__/doc-locks.constants.test.ts`.
 */
export const WEBHOOK_FORWARDED_HEADERS = Object.freeze([
  "content-type",
  "x-telegram-bot-api-secret-token",
  "x-http-channel-token",
  "x-request-id",
  "user-agent",
] as const);

/** O(1) header allowlist lookup for webhook envelope building. */
export const WEBHOOK_FORWARDED_HEADERS_SET = new Set<string>(
  WEBHOOK_FORWARDED_HEADERS
);

/**
 * Verification-secret subset of `WEBHOOK_FORWARDED_HEADERS`. Stage 1 forwards
 * these so channel-service can authenticate the webhook (each is some
 * provider's `signatureHeader`); once the signature check has used them they
 * are stripped, so stage-2 `data.headers` never carries a verification secret
 * (envelope.md §4.1, decided 2026-08-01).
 *
 * Exactly the `signatureHeader` values declared by the registered providers
 * (`TelegramProvider`, `HttpProvider`); `E2eTestsProvider` is outbound-only
 * and declares none.
 */
export const WEBHOOK_SECRET_HEADERS = Object.freeze([
  "x-telegram-bot-api-secret-token",
  "x-http-channel-token",
] as const);

/** O(1) lookup for the post-verification header strip. */
export const WEBHOOK_SECRET_HEADERS_SET = new Set<string>(
  WEBHOOK_SECRET_HEADERS
);

/** Prefix for per-tenant dead-letter JetStream streams. */
export const DLQ_TENANT_STREAM_PREFIX = "DLQ" as const;
export const DLQ_TENANT_SUBJECT_PREFIX = "dlq" as const;
export const DLQ_TENANT_STREAM_MAX_AGE_NS = 30 * 24 * 60 * 60 * 1_000_000_000;
export const DLQ_TENANT_STREAM_MAX_BYTES = 512 * 1024 * 1024;

/**
 * Returns the dead-letter JetStream stream name for a tenant.
 * Shape: `DLQ-<tenantId>`. O(1), deterministic.
 */
export function buildDlqStreamName(tenantId: string): string {
  return `${DLQ_TENANT_STREAM_PREFIX}-${tenantId}`;
}

/**
 * Returns the catch-all subject for a tenant's DLQ stream.
 * Shape: `dlq.<tenantId>.>`. Each terminated message is republished
 * using `dlq.<tenantId>.<original-subject>` to preserve routing info.
 */
export function buildDlqSubjectPattern(tenantId: string): string {
  return `${DLQ_TENANT_SUBJECT_PREFIX}.${tenantId}.>`;
}

/**
 * Builds the concrete DLQ subject for a terminated message.
 * Preserves the original subject as a suffix so Grafana/consumers can
 * still filter by stage/event type.
 */
export function buildDlqMessageSubject(
  tenantId: string,
  originalSubject: string
): string {
  return `${DLQ_TENANT_SUBJECT_PREFIX}.${tenantId}.${originalSubject}`;
}
