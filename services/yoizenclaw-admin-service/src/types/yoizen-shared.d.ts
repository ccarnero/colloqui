// Temporary type declarations for @yoizen/shared
// These are used until the workspace packages are properly built

export const TENANT_HEADER = "x-yoizen-tenant";

// NATS Constants
export const STREAM_NAME = "EVENTS";
export const STREAM_SUBJECTS = ["events.>"];
export const SUBJECT_PREFIX = "events.";
export const STREAM_MAX_AGE_NS = 604800000000000; // 7 days in nanoseconds
export const STREAM_MAX_BYTES = 536870912; // 512 MB

export const CLAIM_CHECK_THRESHOLD_BYTES = 262144; // 256 KB

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
