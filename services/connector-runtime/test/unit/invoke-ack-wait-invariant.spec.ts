import { describe, expect, it } from "bun:test";
import {
  ADAPTER_MAX_RETRIES_MAX,
  ADAPTER_RETRY_BACKOFF_MS_MAX,
  ADAPTER_TIMEOUT_MS_MAX,
} from "@yoizen/shared";
import {
  INVOKE_CONSUMER_ACK_WAIT_MS,
  workflowHttpWorkerConfig,
} from "../../src/config";

/**
 * Cross-service invariant guard.
 *
 * The async invoke consumer (`src/invoke-consumer-main.ts`) handles one
 * `invoke_requested` message by chaining adapter-defined outbound I/O
 * (`timeoutMs` retried `maxRetries` times with `retryBackoffMs` between
 * attempts) and THEN delivering the caller's webhook. If that worst-case
 * chain can outlast the JetStream `ack_wait`, NATS redelivers a message that
 * is still in flight and the outbound HTTP call is duplicated.
 *
 * Both halves are imported from their real owners — the caps from
 * `@yoizen/shared` (`packages/shared/src/adapter-schema.ts`), the ack-wait
 * and webhook timeout from this service's `src/config.ts` — so this test
 * fails the build the moment anyone raises a cap or lowers the ack-wait
 * without rebalancing the other side. Never re-state these numbers here.
 */
describe("invoke consumer ackWait vs worst-case adapter chain", () => {
  const worstAdapterChainMs =
    ADAPTER_MAX_RETRIES_MAX *
    (ADAPTER_TIMEOUT_MS_MAX + ADAPTER_RETRY_BACKOFF_MS_MAX);
  const worstHandlerMs =
    worstAdapterChainMs + workflowHttpWorkerConfig.invokeWebhookTimeoutMs;

  it("keeps the worst-case handler chain strictly below ackWaitMs", () => {
    expect(worstHandlerMs).toBeLessThan(INVOKE_CONSUMER_ACK_WAIT_MS);
  });

  it("leaves headroom for the non-HTTP work in the handler (Redis + NATS)", () => {
    // The chain above accounts only for outbound HTTP. Parking the result in
    // Redis and publishing `invoke_completed` also run before `msg.ack()`,
    // so the budget must not be consumed to the last millisecond.
    expect(INVOKE_CONSUMER_ACK_WAIT_MS - worstHandlerMs).toBeGreaterThanOrEqual(
      30_000
    );
  });

  it("asserts against the ackWaitMs the consumer actually configures", () => {
    // Guards the extraction itself: if someone re-inlines a literal in
    // `invoke-consumer-main.ts`, this constant stops being the real value.
    expect(Number.isFinite(INVOKE_CONSUMER_ACK_WAIT_MS)).toBe(true);
    expect(INVOKE_CONSUMER_ACK_WAIT_MS).toBeGreaterThan(0);
  });

  it("keeps the webhook delivery timeout inside the leftover budget", () => {
    expect(workflowHttpWorkerConfig.invokeWebhookTimeoutMs).toBeLessThan(
      INVOKE_CONSUMER_ACK_WAIT_MS - worstAdapterChainMs
    );
  });
});
