import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AGENT_TEST_DELAY_HARD_CAP_MS,
  agentAiServiceConfig,
} from "../../src/config";

/**
 * Covers long-running-agent-executions.md T02 — the delay hook must default
 * OFF in code (production byte-identical, decision 4) and its cap must never
 * be raisable above the hard cap, which itself sits below both the consumer
 * ackWait and the buffered-execution timeout (900_000 ms each).
 */
describe("agentAiServiceConfig — test delay hook gate/cap (T02)", () => {
  const ENV_KEYS = [
    "AGENT_TEST_DELAY_ENABLED",
    "AGENT_TEST_DELAY_MAX_MS",
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

  it("defaults testDelayEnabled to false when the gate env var is unset", () => {
    expect(agentAiServiceConfig.testDelayEnabled).toBe(false);
  });

  it("only enables on the exact string 'true'", () => {
    process.env.AGENT_TEST_DELAY_ENABLED = "1";
    expect(agentAiServiceConfig.testDelayEnabled).toBe(false);
    process.env.AGENT_TEST_DELAY_ENABLED = "true";
    expect(agentAiServiceConfig.testDelayEnabled).toBe(true);
  });

  it("defaults testDelayMaxMs to the 600_000ms hard cap", () => {
    expect(AGENT_TEST_DELAY_HARD_CAP_MS).toBe(600_000);
    expect(agentAiServiceConfig.testDelayMaxMs).toBe(600_000);
  });

  it("keeps the hard cap strictly below ackWait and the buffered-execution timeout", () => {
    expect(AGENT_TEST_DELAY_HARD_CAP_MS).toBeLessThan(
      agentAiServiceConfig.consumerAckWaitMs
    );
    expect(AGENT_TEST_DELAY_HARD_CAP_MS).toBeLessThan(
      agentAiServiceConfig.bufferedExecutionTimeoutMs
    );
  });

  it("lets AGENT_TEST_DELAY_MAX_MS lower the cap but never raise it", () => {
    process.env.AGENT_TEST_DELAY_MAX_MS = "5000";
    expect(agentAiServiceConfig.testDelayMaxMs).toBe(5000);
    process.env.AGENT_TEST_DELAY_MAX_MS = "99999999";
    expect(agentAiServiceConfig.testDelayMaxMs).toBe(600_000);
  });

  it("falls back to the hard cap on a garbage or non-positive override", () => {
    process.env.AGENT_TEST_DELAY_MAX_MS = "nope";
    expect(agentAiServiceConfig.testDelayMaxMs).toBe(600_000);
    process.env.AGENT_TEST_DELAY_MAX_MS = "0";
    expect(agentAiServiceConfig.testDelayMaxMs).toBe(600_000);
  });
});
