// Template: Envelope Builder
// Creates CloudEvents-inspired envelopes

import { ok, err, type Result } from "../lib/result.js";

export interface Transport {
  method: "webhook" | "poll" | "stream" | "queue_bridge" | "agent";
  protocol: string;
  headers?: Record<string, string>;
  // Método específicos
  poll_source?: string;
  poll_cursor?: string;
  connection_id?: string;
  source_queue?: string;
  delivery_tag?: string;
  agent_id?: string;
  agent_model?: string;
  depth?: number;
}

export interface EnvelopeContext {
  tenant: string;
  producer: string;
  domain: string;
  channel: string;
  provider: string;
  accountid: string;
  traceid: string;
  correlation_id: string;
  causation_id: string | null;
  idempotencykey: string;
  source: string;
  type: string;
  resource: string;
}

export interface Envelope {
  specversion: "1.0";
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
  transport: Transport;
  data: {
    received_at: string;
    payload_inline: boolean;
    payload_ref: string | null;
    payload_bytes: number;
    payload_checksum: string;
    payload: unknown | null;
  };
}

export function buildEnvelope(
  rawBody: unknown,
  transport: Transport,
  context: EnvelopeContext
): Result<Envelope, string> {
  const now = new Date().toISOString();
  const ulid = generateUlid();
  const bodyString = JSON.stringify(rawBody);
  
  const envelope: Envelope = {
    specversion: "1.0",
    id: ulid,
    source: context.source,
    type: context.type,
    resource: context.resource,
    time: now,
    traceid: context.traceid,
    causation_id: context.causation_id,
    correlation_id: context.correlation_id,
    tenant: context.tenant,
    producer: context.producer,
    domain: context.domain,
    channel: context.channel,
    provider: context.provider,
    accountid: context.accountid,
    idempotencykey: context.idempotencykey,
    transport,
    data: {
      received_at: now,
      payload_inline: true,
      payload_ref: null,
      payload_bytes: bodyString.length,
      payload_checksum: computeChecksum(bodyString),
      payload: rawBody,
    },
  };
  
  return ok(envelope);
}

function generateUlid(): string {
  // Implementación de ULID o usar librería
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function computeChecksum(input: string): string {
  // Implementar SHA256
  return "sha256:...";
}
