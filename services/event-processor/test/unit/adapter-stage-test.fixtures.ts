import type { EventEnvelope } from "@yoizen/shared";

/**
 * Minimal valid {@link EventEnvelope} for adapter pipeline unit tests.
 */
export function makeTestEnvelope(
  overrides: Partial<EventEnvelope> & { id: string; type: string },
): EventEnvelope {
  const { id, type } = overrides;
  return {
    specversion: "1.0",
    id,
    source: `events.${type}`,
    type,
    resource: type,
    time: new Date().toISOString(),
    traceid: id,
    causation_id: null,
    correlation_id: id,
    tenant: "t1",
    producer: "test",
    domain: "platform",
    channel: "events",
    provider: "test",
    accountid: "t1",
    idempotencykey: id,
    transport: { method: "stream", protocol: "internal" },
    data: {
      received_at: new Date().toISOString(),
      payload_inline: true,
      payload_ref: null,
      payload_bytes: 0,
      payload_checksum: "",
      payload: {},
    },
    ...overrides,
  };
}
