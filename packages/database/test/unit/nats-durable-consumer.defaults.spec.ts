import { describe, expect, it } from "bun:test";
import {
  DEFAULT_ACK_WAIT_MS,
  DEFAULT_BACKOFF_MS,
} from "../../src/nats-durable-consumer";

/**
 * Constant pin for the durable-consumer defaults (same spirit as
 * packages/shared/src/__tests__/doc-locks.constants.test.ts).
 *
 * These two values are quoted by `packages/database/README.md` and by the
 * `@default` JSDoc tags on `IDurableConsumerOptions`. They previously drifted:
 * the JSDoc claimed `30_000` / `[1s, 5s, 30s, 2m]` long after the source had
 * moved to 60s / [60s, 120s, 300s, 600s]. A too-low ack_wait is not cosmetic
 * here — a stale 1s value caused silent at-least-once duplication of outbound
 * Telegram replies (see the HISTORICAL NOTE in nats-durable-consumer.ts).
 *
 * If you change a value below, update the `@default` tags and the README in
 * the same commit — this test is the tripwire that makes drift a red test
 * instead of a stale comment.
 */
describe("nats-durable-consumer defaults (constant pin)", () => {
  it("DEFAULT_ACK_WAIT_MS is 60_000 (60s)", () => {
    expect(DEFAULT_ACK_WAIT_MS).toBe(60_000);
  });

  it("DEFAULT_BACKOFF_MS is [60s, 120s, 300s, 600s]", () => {
    expect([...DEFAULT_BACKOFF_MS]).toEqual([
      60_000, 120_000, 300_000, 600_000,
    ]);
  });

  it("DEFAULT_BACKOFF_MS anchors its first step at DEFAULT_ACK_WAIT_MS", () => {
    expect(DEFAULT_BACKOFF_MS[0]).toBe(DEFAULT_ACK_WAIT_MS);
  });
});
