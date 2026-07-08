import { afterEach, beforeEach, describe, expect, it } from "bun:test";

/**
 * Covers ASYNC-RESILIENCE-AUDIT.md F1 — the multi-tenant NATS consumer's
 * ackWait must default to a value that comfortably exceeds worst-case
 * `generateReply` runtime (minutes-long LLM/tool chains), and must be
 * overridable per-deployment without a code change.
 */
describe("agentAiServiceConfig — consumer ack-wait / working-interval (F1)", () => {
  const ENV_KEYS = [
    "AGENT_AI_CONSUMER_ACK_WAIT_MS",
    "AGENT_AI_CONSUMER_WORKING_INTERVAL_MS",
  ] as const;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) {
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = originalEnv[k];
      }
    }
  });

  it("defaults consumerAckWaitMs to 900_000ms (matches AGENT_CALL_TIMEOUT_MS) when unset", async () => {
    const { agentAiServiceConfig } = await import("../../src/config");
    expect(agentAiServiceConfig.consumerAckWaitMs).toBe(900_000);
  });

  it("honors AGENT_AI_CONSUMER_ACK_WAIT_MS override", async () => {
    process.env.AGENT_AI_CONSUMER_ACK_WAIT_MS = "123456";
    const { agentAiServiceConfig } = await import("../../src/config");
    expect(agentAiServiceConfig.consumerAckWaitMs).toBe(123_456);
  });

  it("defaults consumerWorkingIntervalMs to 30_000ms when unset", async () => {
    const { agentAiServiceConfig } = await import("../../src/config");
    expect(agentAiServiceConfig.consumerWorkingIntervalMs).toBe(30_000);
  });

  it("honors AGENT_AI_CONSUMER_WORKING_INTERVAL_MS override", async () => {
    process.env.AGENT_AI_CONSUMER_WORKING_INTERVAL_MS = "7000";
    const { agentAiServiceConfig } = await import("../../src/config");
    expect(agentAiServiceConfig.consumerWorkingIntervalMs).toBe(7000);
  });
});
