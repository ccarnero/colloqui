import { beforeEach, describe, expect, it, mock } from "bun:test";

// PinoLoggerService is a field initializer, not constructor-injected, so it
// must be mocked before the import resolves (same pattern as
// execution-handler-buffered.spec.ts / llm-call-event-publisher.service.spec.ts).
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

import { LlmActionService } from "../../src/modules/job-executor/actions/llm-action.service";
import type { LlmCallEventPublisherService } from "../../src/modules/llm/llm-call-event-publisher.service";
import type { LlmExecutorService } from "../../src/modules/llm/llm-executor.service";

function fakeGenerateTextResult(overrides: Record<string, unknown> = {}) {
  return {
    text: "generated completion",
    model: "gpt-4o-mini",
    provider: "openai",
    usage: {
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      cachedInputTokens: 0,
    },
    costUsd: 0.0002,
    toolCalls: [],
    ...overrides,
  };
}

describe("LlmActionService — standalone LLM call event emission (T04)", () => {
  let mockLlmExecutor: { generateText: ReturnType<typeof mock> };
  let mockPublisher: { publish: ReturnType<typeof mock> };
  let action: LlmActionService;

  beforeEach(() => {
    mockLlmExecutor = {
      generateText: mock(() => Promise.resolve(fakeGenerateTextResult())),
    };
    mockPublisher = { publish: mock(() => {}) };

    action = new LlmActionService(
      mockLlmExecutor as unknown as LlmExecutorService,
      mockPublisher as unknown as LlmCallEventPublisherService
    );
  });

  it("publishes ai.llm_call.completed.v1 via the event publisher for a standalone (job-executor) call", async () => {
    await action.execute(
      "acme",
      "agent-1",
      {
        prompt: "Summarize {{topic}}",
        model: "gpt-4o-mini",
        provider: "openai",
      },
      { topic: "cats" },
      "exec-standalone-1"
    );

    expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
    const evt = mockPublisher.publish.mock.calls[0][0];
    expect(evt.tenantId).toBe("acme");
    expect(evt.agentId).toBe("agent-1");
    expect(evt.executionId).toBe("exec-standalone-1");
    expect(evt.model).toBe("gpt-4o-mini");
    expect(evt.provider).toBe("openai");
    expect(evt.prompt).toBe("Summarize cats");
    expect(evt.completion).toBe("generated completion");
    expect(evt.inputTokens).toBe(20);
    expect(evt.outputTokens).toBe(10);
    expect(evt.cachedInputTokens).toBe(0);
    expect(evt.costUsd).toBe(0.0002);
    expect(typeof evt.durationMs).toBe("number");
    expect(evt.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("threads the incoming envelope as causalEnvelope when the caller has one", async () => {
    const incoming = { id: "incoming-1" } as any;

    await action.execute(
      "acme",
      "agent-1",
      { prompt: "hi" },
      {},
      "exec-causal-1",
      incoming
    );

    const evt = mockPublisher.publish.mock.calls[0][0];
    expect(evt.causalEnvelope).toBe(incoming);
  });

  it("omits causalEnvelope when the job run has no incoming envelope (causal root)", async () => {
    await action.execute(
      "acme",
      "agent-1",
      { prompt: "hi" },
      {},
      "exec-root-1"
    );

    const evt = mockPublisher.publish.mock.calls[0][0];
    expect(evt.causalEnvelope).toBeUndefined();
  });

  it("does not fail the LLM call when the event publisher throws synchronously", async () => {
    mockPublisher.publish = mock(() => {
      throw new Error("publisher exploded");
    });

    // Even a broken publisher (throwing synchronously, worse-case scenario)
    // must not break the action's return value — the call site wraps
    // `publish()` in try/catch as a defensive belt on top of the
    // publisher's own never-throws-synchronously contract.
    const result = await action.execute(
      "acme",
      "agent-1",
      { prompt: "hi" },
      {},
      "exec-2"
    );

    expect(result.content).toBe("generated completion");
    expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
  });

  it("returns the LLM result content/model/provider/usage/cost regardless of publish outcome", async () => {
    const result = await action.execute(
      "acme",
      "agent-1",
      { prompt: "hi" },
      {},
      "exec-3"
    );

    expect(result.content).toBe("generated completion");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.provider).toBe("openai");
    expect(result.usage.totalTokens).toBe(30);
    expect(result.costUsd).toBe(0.0002);
  });

  it("passes the resolved prompt/model/provider through to llmExecutor.generateText", async () => {
    await action.execute(
      "acme",
      "agent-1",
      {
        prompt: "Translate {{word}}",
        model: "claude-3",
        provider: "anthropic",
      },
      { word: "hello" },
      "exec-4"
    );

    expect(mockLlmExecutor.generateText).toHaveBeenCalledTimes(1);
    const callArg = mockLlmExecutor.generateText.mock.calls[0][0];
    expect(callArg.prompt).toBe("Translate hello");
    expect(callArg.model).toBe("claude-3");
    expect(callArg.provider).toBe("anthropic");
  });
});
