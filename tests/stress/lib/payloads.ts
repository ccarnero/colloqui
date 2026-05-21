/**
 * Payload pools for Phase 1 scenarios.
 *
 * Two size buckets per scenario kind (matches the plan: median ~2 KB and p95
 * ~32 KB). Pools are generated once at module init — O(1) lookup at iteration
 * time. The random index uses a single divide+floor, no array shuffles.
 *
 * NATS `max_payload` is 1 MB. The 32 KB pool stays well under that even after
 * envelope + headers are added downstream.
 */

import type { CorrelationEnvelope } from "./correlation.ts";

export const PAYLOAD_SIZE = Object.freeze({
  MEDIAN: "median",
  P95: "p95",
});
export type PayloadSize = (typeof PAYLOAD_SIZE)[keyof typeof PAYLOAD_SIZE];

const BYTE_TARGETS: ReadonlyMap<PayloadSize, number> = new Map([
  [PAYLOAD_SIZE.MEDIAN, 2_048],
  [PAYLOAD_SIZE.P95, 32_768],
]);

const POOL_SIZE = 16;
const FILLER_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function buildFiller(targetBytes: number, baseLen: number): string {
  const remaining = Math.max(0, targetBytes - baseLen);
  if (remaining === 0) {
    return "";
  }
  const chunks: string[] = [];
  let written = 0;
  while (written < remaining) {
    const idx = Math.floor(Math.random() * FILLER_ALPHABET.length);
    chunks.push(FILLER_ALPHABET[idx] ?? "x");
    written += 1;
  }
  return chunks.join("");
}

interface EventPool {
  readonly entries: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly bytes: number;
}

const eventPools = new Map<PayloadSize, EventPool>();
const webhookPools = new Map<PayloadSize, EventPool>();

function buildEventPool(targetBytes: number): EventPool {
  const entries: Array<Readonly<Record<string, unknown>>> = new Array(
    POOL_SIZE
  );
  for (let index = 0; index < POOL_SIZE; index += 1) {
    const base: Record<string, unknown> = {
      action: "created",
      source: "stress-phase1",
      type: "stress-event",
      value: index,
    };
    const baseLen = JSON.stringify(base).length;
    base.filler = buildFiller(targetBytes, baseLen + 16);
    entries[index] = Object.freeze(base);
  }
  return Object.freeze({ bytes: targetBytes, entries: Object.freeze(entries) });
}

function buildWebhookPool(targetBytes: number): EventPool {
  const entries: Array<Readonly<Record<string, unknown>>> = new Array(
    POOL_SIZE
  );
  for (let index = 0; index < POOL_SIZE; index += 1) {
    const base: Record<string, unknown> = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: { body: `phase1-stress-${index}`, ts: Date.now() },
            },
          ],
          id: `stress-entry-${index}`,
        },
      ],
      object: "whatsapp_business_account",
    };
    const baseLen = JSON.stringify(base).length;
    base.filler = buildFiller(targetBytes, baseLen + 16);
    entries[index] = Object.freeze(base);
  }
  return Object.freeze({ bytes: targetBytes, entries: Object.freeze(entries) });
}

for (const [size, bytes] of BYTE_TARGETS) {
  eventPools.set(size, buildEventPool(bytes));
  webhookPools.set(size, buildWebhookPool(bytes));
}

function pickFromPool(pool: EventPool): Readonly<Record<string, unknown>> {
  const length = pool.entries.length;
  const idx = Math.floor(Math.random() * length);
  return pool.entries[idx] ?? pool.entries[0] ?? {};
}

export interface EventRequestBody {
  readonly callbackUrl?: string;
  readonly correlation_id: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sent_at: number;
  readonly stage: string;
  readonly type: string;
}

export function buildEventBody(
  envelope: CorrelationEnvelope,
  size: PayloadSize,
  callbackUrl?: string
): EventRequestBody {
  const pool = eventPools.get(size);
  if (!pool) {
    throw new Error(`No event pool configured for size '${size}'.`);
  }
  const payload = pickFromPool(pool);
  const body: EventRequestBody = {
    correlation_id: envelope.correlation_id,
    payload,
    sent_at: envelope.sent_at,
    stage: envelope.stage,
    type: "stress-phase1-event",
    ...(callbackUrl ? { callbackUrl } : {}),
  };
  return body;
}

export interface WebhookRequestBody {
  readonly correlation_id: string;
  readonly entry: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly object: string;
  readonly sent_at: number;
  readonly stage: string;
}

export function buildWebhookBody(
  envelope: CorrelationEnvelope,
  size: PayloadSize
): WebhookRequestBody {
  const pool = webhookPools.get(size);
  if (!pool) {
    throw new Error(`No webhook pool configured for size '${size}'.`);
  }
  const payload = pickFromPool(pool) as {
    entry: ReadonlyArray<Readonly<Record<string, unknown>>>;
    object: string;
  };
  return {
    correlation_id: envelope.correlation_id,
    entry: payload.entry,
    object: payload.object,
    sent_at: envelope.sent_at,
    stage: envelope.stage,
  };
}

export function getPoolSize(
  kind: "events" | "webhook",
  size: PayloadSize
): number {
  const pool =
    kind === "events" ? eventPools.get(size) : webhookPools.get(size);
  return pool?.bytes ?? 0;
}
