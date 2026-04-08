export const CHANNEL_STREAM_PREFIX = "INGRESS";
export const CHANNEL_STREAM_SUBJECTS_PATTERN = "evt.*.messaging.>" as const;
export const CHANNEL_CONSUMER_NAME = "channel-processor";

export const CHANNEL_SUBJECT_PREFIX = "evt";
export const CHANNEL_DOMAIN = "messaging";

export const CHANNEL_STREAM_MAX_AGE_NS = 7 * 24 * 60 * 60 * 1_000_000_000;
export const CHANNEL_STREAM_MAX_BYTES = 256 * 1024 * 1024;
export const CHANNEL_MAX_DELIVER = 5;

export const CLAIM_CHECK_THRESHOLD_BYTES = 256 * 1024;
export const CLAIM_CHECK_BUCKET_PREFIX = "PAYLOAD";

export const CHANNEL_AUDIT_SUBJECT_PATTERN = "evt.*.messaging.>" as const;

export const CHANNEL_SEND_SUBJECT_PATTERN =
  "evt.*.messaging.*.*.send.v1" as const;
