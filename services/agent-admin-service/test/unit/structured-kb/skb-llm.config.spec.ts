import "../../setup-env";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

/**
 * Covers DOC-VS-CODE-AUDIT.md SKB defect 5 — the LLM provider/model for
 * SKB schema analysis and NL→SQL translation used to be hardcoded to
 * openai/gpt-4o independently in two places. `skbLlmConfig` centralizes
 * the default and makes it overridable via env without a code change.
 */
describe("skbLlmConfig (SKB defect 5)", () => {
  const ENV_KEYS = ["SKB_LLM_PROVIDER", "SKB_LLM_MODEL_ID"] as const;
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

  it("defaults provider to 'openai' when SKB_LLM_PROVIDER is unset", async () => {
    const { skbLlmConfig } = await import(
      "../../src/modules/structured-kb/skb-llm.config"
    );
    expect(skbLlmConfig.provider).toBe("openai");
  });

  it("defaults modelId to 'gpt-4o' when SKB_LLM_MODEL_ID is unset", async () => {
    const { skbLlmConfig } = await import(
      "../../src/modules/structured-kb/skb-llm.config"
    );
    expect(skbLlmConfig.modelId).toBe("gpt-4o");
  });

  it("honors SKB_LLM_PROVIDER override", async () => {
    process.env.SKB_LLM_PROVIDER = "anthropic";
    const { skbLlmConfig } = await import(
      "../../src/modules/structured-kb/skb-llm.config"
    );
    expect(skbLlmConfig.provider).toBe("anthropic");
  });

  it("honors SKB_LLM_MODEL_ID override", async () => {
    process.env.SKB_LLM_MODEL_ID = "claude-sonnet";
    const { skbLlmConfig } = await import(
      "../../src/modules/structured-kb/skb-llm.config"
    );
    expect(skbLlmConfig.modelId).toBe("claude-sonnet");
  });

  it("honors both overrides simultaneously", async () => {
    process.env.SKB_LLM_PROVIDER = "anthropic";
    process.env.SKB_LLM_MODEL_ID = "claude-sonnet";
    const { skbLlmConfig } = await import(
      "../../src/modules/structured-kb/skb-llm.config"
    );
    expect(skbLlmConfig.provider).toBe("anthropic");
    expect(skbLlmConfig.modelId).toBe("claude-sonnet");
  });
});
