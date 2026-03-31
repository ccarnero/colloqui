// Temporary type declarations for @yoizen/shared
// These are used until the workspace packages are properly built

export const TENANT_HEADER = "x-yoizen-tenant";

// NATS Constants
export const STREAM_NAME = "INGRESS";
export const STREAM_SUBJECTS = ["evt.*.>"];
export const STREAM_MAX_AGE_NS = 604800000000000; // 7 days in nanoseconds
export const STREAM_MAX_BYTES = 536870912; // 512 MB

export const CLAIM_CHECK_THRESHOLD_BYTES = 262144; // 256 KB

export const YOIZENCLAW_PRODUCER = "yoizenclaw-admin-service";
export const YOIZENCLAW_DOMAIN = "automation";
export const YOIZENCLAW_CHANNEL = "yoizenclaw";
export const YOIZENCLAW_PROVIDER = "internal";
export const YOIZENCLAW_ACCOUNT_ID = "yoizenclaw-admin";

export const YOIZENCLAW_SUBJECT_PREFIX =
  "evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal";

export const YOIZENCLAW_AGENT_PUBLISHED =
  `${YOIZENCLAW_SUBJECT_PREFIX}.agent_published.v1`;
export const YOIZENCLAW_AGENT_UNPUBLISHED =
  `${YOIZENCLAW_SUBJECT_PREFIX}.agent_unpublished.v1`;
export const YOIZENCLAW_CREDENTIAL_ROTATED =
  `${YOIZENCLAW_SUBJECT_PREFIX}.credential_rotated.v1`;
export const YOIZENCLAW_CONFIG_SYNC =
  `${YOIZENCLAW_SUBJECT_PREFIX}.config_sync.v1`;
export const YOIZENCLAW_JOBS_SYNC =
  `${YOIZENCLAW_SUBJECT_PREFIX}.jobs_sync.v1`;
export const YOIZENCLAW_JOB_TRIGGER =
  `${YOIZENCLAW_SUBJECT_PREFIX}.job_trigger.v1`;

export function buildYoizenClawSubject(
  template: string,
  tenantId: string,
): string;

export interface EventTransport {
  method: "webhook" | "poll" | "stream" | "queue_bridge" | "agent";
  protocol: "https" | "wss" | "amqp" | "internal";
}

export interface EventData {
  received_at: string;
  payload_inline: boolean;
  payload_ref: string | null;
  payload_bytes: number;
  payload_checksum: string;
  payload: Record<string, unknown> | null;
}

export interface EventEnvelope {
  specversion: string;
  id: string;
  source: string;
  type: string;
  resource: string;
  time: string;
  traceid: string;
  causation_id: string | null;
  correlation_id: string;
  tenant: string;
  producer: string;
  domain: string;
  channel: string;
  provider: string;
  accountid: string;
  idempotencykey: string;
  transport: EventTransport;
  data: EventData;
}
