const PAYLOAD_KIND = {
  EVENTS: "events",
  WEBHOOK: "webhook",
} as const;

type PayloadKind = (typeof PAYLOAD_KIND)[keyof typeof PAYLOAD_KIND];

type FrozenPayload = Readonly<Record<string, unknown>>;

function freezePayload(payload: Record<string, unknown>): FrozenPayload {
  return Object.freeze(payload);
}

const payloadPools = new Map<PayloadKind, ReadonlyArray<FrozenPayload>>([
  [
    PAYLOAD_KIND.EVENTS,
    Object.freeze([
      freezePayload({
        callbackUrl: "https://httpbin.org/post",
        payload: { action: "created", source: "stress", value: 1 },
        type: "stress-created",
      }),
      freezePayload({
        callbackUrl: "https://httpbin.org/post",
        payload: { action: "updated", field: "status", source: "stress", value: 2 },
        type: "stress-updated",
      }),
      freezePayload({
        callbackUrl: "https://httpbin.org/post",
        payload: { action: "deleted", reason: "retention", source: "stress", value: 3 },
        type: "stress-deleted",
      }),
      freezePayload({
        callbackUrl: "https://httpbin.org/post",
        payload: { action: "custom", source: "stress", value: 4 },
        type: "stress-custom",
      }),
    ]),
  ],
  [
    PAYLOAD_KIND.WEBHOOK,
    Object.freeze([
      freezePayload({
        entry: [
          {
            changes: [{ field: "messages", value: { body: "hello from stress" } }],
            id: "stress-entry-a",
          },
        ],
        object: "whatsapp_business_account",
      }),
      freezePayload({
        entry: [
          {
            changes: [{ field: "statuses", value: { status: "sent" } }],
            id: "stress-entry-b",
          },
        ],
        object: "whatsapp_business_account",
      }),
      freezePayload({
        entry: [
          {
            changes: [{ field: "messages", value: { body: "load sample payload" } }],
            id: "stress-entry-c",
          },
        ],
        object: "whatsapp_business_account",
      }),
    ]),
  ],
]);

const poolIndexes = new Map<PayloadKind, number>();

function nextIndex(kind: PayloadKind, length: number): number {
  const current = poolIndexes.get(kind) ?? 0;
  poolIndexes.set(kind, current + 1);
  return current % length;
}

export function getNextPayload(kind: PayloadKind): FrozenPayload {
  const pool = payloadPools.get(kind);
  if (!pool || pool.length === 0) {
    throw new Error(`No payload pool configured for kind '${kind}'.`);
  }

  return pool[nextIndex(kind, pool.length)];
}

export function getPayloadKinds(): typeof PAYLOAD_KIND {
  return PAYLOAD_KIND;
}
