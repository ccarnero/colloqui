/**
 * Safe JSON-compatible value type. Use instead of `any` for
 * unstructured data stored as JSONB or passed through message envelopes.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface EventTransport {
  method: "webhook" | "poll" | "stream" | "queue_bridge" | "agent";
  protocol: "https" | "wss" | "amqp" | "internal";
  agent_id?: string;
  depth?: number;
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

  /** Pipeline extension: URL to POST completion results to */
  callback_url?: string;
  /** Pipeline extension: adapter ID for webhook delivery auth */
  adapter_id?: string;
  /** Pipeline extension: adapter ref for pre-handler enrichment */
  enrich_adapter?: { adapterId: string; endpointId: string };
  /** Pipeline extension: adapter ref for post-handler forwarding */
  forward_adapter?: { adapterId: string; endpointId: string };
}

