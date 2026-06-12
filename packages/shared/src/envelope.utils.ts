import { createHash, randomUUID } from "node:crypto";
import type { EventData, EventEnvelope, EventTransport, JsonValue } from "./interfaces";

/**
 * Producer categories for anti-loop MAX_DEPTH enforcement (D12).
 * See DOCS/messaging/envelope.md §6.3.
 */
export type ProducerCategory =
  | "root"
  | "internal_service"
  | "internal_agent"
  | "platform_agent"
  | "thirdparty_agent";

export const MAX_DEPTH_BY_CATEGORY: Readonly<Record<ProducerCategory, number>> =
  {
    root: 0,
    internal_service: 5,
    internal_agent: 5,
    platform_agent: 3,
    thirdparty_agent: 2,
  };

/** Default anti-loop ceiling when the producer category is unknown. */
export const DEFAULT_MAX_DEPTH = 5;

/**
 * Recursive canonical JSON: sorts object keys alphabetically at every
 * depth so structurally equal payloads produce identical strings.
 * Mirrors `serializeCanonicalPayload` in agent-admin-service.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    // Match JSON.stringify: undefined at the top level becomes "null".
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj).sort();
  const pairs: string[] = [];
  for (const key of entries) {
    // Skip undefined values — matches JSON.stringify which omits them.
    if (obj[key] === undefined) continue;
    pairs.push(
      `${JSON.stringify(key)}:${canonicalJson(obj[key])}`,
    );
  }
  return `{${pairs.join(",")}}`;
}

/**
 * sha256 over canonical JSON, returned as `"sha256:<hex>"`.
 * Used for both `idempotencykey` and `data.payload_checksum`.
 */
export function sha256Canonical(value: unknown): string {
  const hash = createHash("sha256").update(canonicalJson(value)).digest("hex");
  return `sha256:${hash}`;
}

/**
 * Deterministic idempotency key for the raw payload.
 * Guarantees identical payloads yield identical keys, which is required
 * for JetStream `Nats-Msg-Id` deduplication (D11 + §7).
 */
export function computeIdempotencyKey(payload: unknown): string {
  return sha256Canonical(payload);
}

/** Alias to emphasise semantics at call sites. */
export function computePayloadChecksum(payload: unknown): string {
  return sha256Canonical(payload);
}

/** UTF-8 byte length of canonical JSON. Useful to fill `payload_bytes`. */
export function canonicalByteLength(payload: unknown): number {
  return Buffer.byteLength(canonicalJson(payload), "utf8");
}

/** Params for the canonical subject builder (§3). */
export interface BuildSubjectParams {
  tenant: string;
  producer: string;
  domain: string;
  channel: string;
  provider: string;
  kind: string;
  version?: string;
}

/**
 * Canonical 8-token NATS subject:
 * `evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>`.
 */
export function buildSubject(params: BuildSubjectParams): string {
  const version = params.version ?? "v1";
  return `evt.${params.tenant}.${params.producer}.${params.domain}.${params.channel}.${params.provider}.${params.kind}.${version}`;
}

/**
 * Parsed representation of a canonical subject. `null` when the subject
 * does not match the 8-token shape.
 */
export interface ParsedSubject {
  tenant: string;
  producer: string;
  domain: string;
  channel: string;
  provider: string;
  kind: string;
  version: string;
}

export function parseSubject(subject: string): ParsedSubject | null {
  const parts = subject.split(".");
  if (parts.length !== 8 || parts[0] !== "evt") return null;
  return {
    tenant: parts[1],
    producer: parts[2],
    domain: parts[3],
    channel: parts[4],
    provider: parts[5],
    kind: parts[6],
    version: parts[7],
  };
}

/** Overrides accepted when deriving a new envelope from an incoming one. */
export interface DeriveEnvelopeOverrides {
  id: string;
  type: string;
  source: string;
  resource?: string;
  kind?: string;
  payload: Record<string, unknown>;
  producer?: string;
  domain?: string;
  channel?: string;
  provider?: string;
  accountid?: string;
  time?: string;
  transportExtras?: Partial<EventTransport>;
  /**
   * Producer category used to pick the MAX_DEPTH ceiling. Defaults to
   * `internal_service`.
   */
  category?: ProducerCategory;
}

/**
 * Builds a derived envelope preserving the causal chain from `incoming`:
 * `causation_id = incoming.id`, `correlation_id` copied, `traceid` copied
 * (caller should override with the active OTEL traceId when possible),
 * `transport.depth = incoming.transport.depth + 1`.
 *
 * Throws `DepthExceededError` when the new depth would exceed MAX_DEPTH
 * for the chosen category.
 */
export function deriveEnvelope(
  incoming: EventEnvelope,
  overrides: DeriveEnvelopeOverrides,
): EventEnvelope {
  const category = overrides.category ?? "internal_service";
  const incomingDepth = incoming.transport?.depth ?? 0;
  const newDepth = incomingDepth + 1;
  const maxDepth = MAX_DEPTH_BY_CATEGORY[category] ?? DEFAULT_MAX_DEPTH;

  if (newDepth > maxDepth) {
    throw new DepthExceededError(
      `Causal depth ${newDepth} exceeds MAX_DEPTH=${maxDepth} for category=${category} ` +
        `(incoming.id=${incoming.id}, correlation_id=${incoming.correlation_id})`,
      { incomingId: incoming.id, newDepth, maxDepth, category },
    );
  }

  const now = overrides.time ?? new Date().toISOString();
  const payloadBytes = canonicalByteLength(overrides.payload);
  const payloadChecksum = computePayloadChecksum(overrides.payload);
  const idempotencykey = computeIdempotencyKey(overrides.payload);

  return {
    specversion: "1.0",
    id: overrides.id,
    source: overrides.source,
    type: overrides.type,
    resource:
      overrides.resource ??
      incoming.resource ??
      `tenant/${incoming.tenant}/account/${overrides.accountid ?? incoming.accountid}`,
    time: now,
    traceid: incoming.traceid,
    causation_id: incoming.id,
    correlation_id: incoming.correlation_id,
    tenant: incoming.tenant,
    producer: overrides.producer ?? incoming.producer,
    domain: overrides.domain ?? incoming.domain,
    channel: overrides.channel ?? incoming.channel,
    provider: overrides.provider ?? incoming.provider,
    accountid: overrides.accountid ?? incoming.accountid,
    idempotencykey,
    transport: {
      method: incoming.transport?.method ?? "stream",
      protocol: incoming.transport?.protocol ?? "internal",
      ...(incoming.transport?.agent_id && {
        agent_id: incoming.transport.agent_id,
      }),
      ...(overrides.transportExtras ?? {}),
      depth: newDepth,
    },
    data: {
      received_at: now,
      payload_inline: true,
      payload_ref: null,
      payload_bytes: payloadBytes,
      payload_checksum: payloadChecksum,
      payload: overrides.payload as Record<string, JsonValue>,
    },
  };
}

/** Thrown by `deriveEnvelope` when the next depth would exceed MAX_DEPTH. */
export class DepthExceededError extends Error {
  public readonly details: {
    incomingId: string;
    newDepth: number;
    maxDepth: number;
    category: ProducerCategory;
  };

  constructor(
    message: string,
    details: DepthExceededError["details"],
  ) {
    super(message);
    this.name = "DepthExceededError";
    this.details = details;
  }
}

/** Options for building a fresh (non-derived) CloudEvents envelope. */
export interface BuildEventEnvelopeOptions {
  /** Unique event ID. Defaults to `randomUUID()`. */
  id?: string;
  /** Event type URI, e.g. `"io.yoizen.platform.runtime.execution_requested.v1"`. */
  type: string;
  /** Producer source URI, e.g. `"ai-agent-gateway"`. */
  source: string;
  /** Resource identifier, e.g. `"execution/{executionId}"`. */
  resource: string;
  /** Tenant identifier. */
  tenant: string;
  /** Producer name (used in envelope `producer` field). */
  producer: string;
  /** Envelope `domain` field. */
  domain: string;
  /** Envelope `channel` field. */
  channel: string;
  /** Envelope `provider` field. */
  provider: string;
  /** Envelope `accountid` field. */
  accountid: string;
  /** The actual payload to embed in `data.payload`. */
  payload: Record<string, unknown>;
  /** ISO timestamp. Defaults to `new Date().toISOString()`. */
  time?: string;
  /** OTEL trace ID. Defaults to a random UUID. */
  traceid?: string;
  /** Causation ID from the triggering event. */
  causationId?: string | null;
  /** Correlation ID for tracing a logical flow. */
  correlationId?: string;
  /** Transport overrides. Defaults to `{ method: "agent", protocol: "internal", depth: 0 }`. */
  transport?: Partial<EventTransport>;
  /** Producer category for depth enforcement. Defaults to `"internal_service"`. */
  category?: ProducerCategory;
  /** Explicit depth. Defaults to `transport.depth ?? 0`. */
  depth?: number;
}

/**
 * Builds a fresh CloudEvents-compliant envelope from scratch.
 *
 * Unlike `deriveEnvelope` (which requires an incoming envelope to chain
 * causation), this creates a root envelope suitable for new event origins
 * such as the runtime-gateway publishing execution requests.
 */
export function buildEventEnvelope(
  options: BuildEventEnvelopeOptions,
): EventEnvelope {
  const depth = options.depth ?? options.transport?.depth ?? 0;
  const category = options.category ?? "internal_service";
  const maxDepth = MAX_DEPTH_BY_CATEGORY[category] ?? DEFAULT_MAX_DEPTH;

  if (depth > maxDepth) {
    throw new DepthExceededError(
      `Causal depth ${depth} exceeds MAX_DEPTH=${maxDepth} for category=${category} ` +
        `(event_type=${options.type}, tenant=${options.tenant})`,
      {
        incomingId: options.causationId ?? "",
        newDepth: depth,
        maxDepth,
        category,
      },
    );
  }

  const time = options.time ?? new Date().toISOString();
  const serialized = canonicalJson(options.payload);

  const data: EventData = {
    received_at: time,
    payload_inline: true,
    payload_ref: null,
    payload_bytes: Buffer.byteLength(serialized, "utf-8"),
    payload_checksum: computePayloadChecksum(options.payload),
    payload: options.payload,
  };

  return {
    specversion: "1.0",
    id: options.id ?? randomUUID(),
    source: options.source,
    type: options.type,
    resource: options.resource,
    time,
    traceid: options.traceid ?? randomUUID(),
    causation_id: options.causationId ?? null,
    correlation_id: options.correlationId ?? randomUUID(),
    tenant: options.tenant,
    producer: options.producer,
    domain: options.domain,
    channel: options.channel,
    provider: options.provider,
    accountid: options.accountid,
    idempotencykey: computeIdempotencyKey(options.payload),
    transport: {
      method: options.transport?.method ?? "agent",
      protocol: options.transport?.protocol ?? "internal",
      agent_id: options.transport?.agent_id ?? options.producer,
      depth,
    },
    data,
  };
}

/**
 * Type guard: returns true when the object has every mandatory envelope
 * field (§2.1). Does **not** validate types deeply — for fast assertions.
 */
export function isCompliantEnvelope(value: unknown): value is EventEnvelope {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.specversion === "1.0" &&
    typeof v.id === "string" &&
    typeof v.source === "string" &&
    typeof v.type === "string" &&
    typeof v.resource === "string" &&
    typeof v.time === "string" &&
    typeof v.traceid === "string" &&
    (v.causation_id === null || typeof v.causation_id === "string") &&
    typeof v.correlation_id === "string" &&
    typeof v.tenant === "string" &&
    typeof v.producer === "string" &&
    typeof v.domain === "string" &&
    typeof v.channel === "string" &&
    typeof v.provider === "string" &&
    typeof v.accountid === "string" &&
    typeof v.idempotencykey === "string" &&
    typeof v.transport === "object" &&
    v.transport !== null &&
    typeof v.data === "object" &&
    v.data !== null
  );
}
