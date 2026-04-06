import { mock } from "bun:test";
import type { Consumer } from "nats";

/** Minimal JetStream consumer stub for AuditService / GatewayAuditService tests. */
export function makeMockJetStreamConsumer(): Consumer {
  return {
    consume: mock(() =>
      Promise.resolve({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ done: true, value: undefined }),
        }),
        stop: mock(),
      }),
    ),
  } as unknown as Consumer;
}
