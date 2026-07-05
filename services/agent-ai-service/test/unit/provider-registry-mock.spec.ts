import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  ProviderRegistryService,
  RUNTIME_ALLOW_MOCK_PROVIDER_ENV,
} from "../../src/modules/llm/provider-registry.service";

/**
 * Covers the dev-only `mock` (echo) provider added for runtime token
 * streaming E2E testing without real LLM credentials
 * (DOCS/architecture/runtime-streaming.md §5.2).
 */
describe("ProviderRegistryService — mock echo provider", () => {
  let registry: ProviderRegistryService;
  let originalEnv: string | undefined;

  beforeEach(() => {
    registry = new ProviderRegistryService();
    originalEnv = process.env[RUNTIME_ALLOW_MOCK_PROVIDER_ENV];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[RUNTIME_ALLOW_MOCK_PROVIDER_ENV];
    } else {
      process.env[RUNTIME_ALLOW_MOCK_PROVIDER_ENV] = originalEnv;
    }
  });

  it("throws when RUNTIME_ALLOW_MOCK_PROVIDER is not set", () => {
    delete process.env[RUNTIME_ALLOW_MOCK_PROVIDER_ENV];
    expect(() => registry.createModel("mock", "echo-1", "")).toThrow(
      /disabled/i
    );
  });

  it("throws when RUNTIME_ALLOW_MOCK_PROVIDER is set to something other than 'true'", () => {
    process.env[RUNTIME_ALLOW_MOCK_PROVIDER_ENV] = "1";
    expect(() => registry.createModel("mock", "echo-1", "")).toThrow(
      /disabled/i
    );
  });

  it("creates a model when RUNTIME_ALLOW_MOCK_PROVIDER=true", () => {
    process.env[RUNTIME_ALLOW_MOCK_PROVIDER_ENV] = "true";
    const model = registry.createModel("mock", "echo-1", "");
    expect(model).toBeDefined();
    expect((model as { modelId?: string }).modelId).toBe("echo-1");
  });

  it("is case-insensitive on the provider name", () => {
    process.env[RUNTIME_ALLOW_MOCK_PROVIDER_ENV] = "true";
    const model = registry.createModel("MOCK", "echo-1", "");
    expect(model).toBeDefined();
  });

  it("echoes the last user message word-by-word as text-delta chunks", async () => {
    process.env[RUNTIME_ALLOW_MOCK_PROVIDER_ENV] = "true";
    const model = registry.createModel("mock", "echo-1", "") as {
      doStream: (options: {
        prompt: Array<{ role: string; content: unknown }>;
      }) => Promise<{
        stream: ReadableStream<{ type: string; delta?: string }>;
      }>;
    };

    const { stream } = await model.doStream({
      prompt: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "Hello world" },
      ],
    });

    const reader = stream.getReader();
    const deltas: string[] = [];
    let finished = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value.type === "text-delta" && typeof value.delta === "string") {
        deltas.push(value.delta);
      }
      if (value.type === "finish") {
        finished = true;
      }
    }

    expect(deltas.join("")).toBe("Hello world");
    expect(finished).toBe(true);
  });

  it("echoes '(empty prompt)' when there is no usable prompt text", async () => {
    process.env[RUNTIME_ALLOW_MOCK_PROVIDER_ENV] = "true";
    const model = registry.createModel("mock", "echo-1", "") as {
      doStream: (options: {
        prompt: Array<{ role: string; content: unknown }>;
      }) => Promise<{
        stream: ReadableStream<{ type: string; delta?: string }>;
      }>;
    };

    const { stream } = await model.doStream({ prompt: [] });
    const reader = stream.getReader();
    const deltas: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value.type === "text-delta" && typeof value.delta === "string") {
        deltas.push(value.delta);
      }
    }
    expect(deltas.join("")).toBe("(empty prompt)");
  });
});
