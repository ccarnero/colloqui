import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { JetStreamClient, Msg, NatsConnection } from "nats";

// ── Module Mocks ──────────────────────────────────────────────────────────
// PinoLoggerService is a field initializer, not constructor-injected, so it
// must be mocked before the import resolves (same pattern as
// execution-handler-buffered.spec.ts).
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

import type { ChatService } from "../../src/modules/chat/chat.service";
import { ExecutionHandler } from "../../src/nats-handlers/execution.handler";

/**
 * Covers long-running-agent-executions.md T02 — the deterministic delay hook
 * on the REAL buffered execution path (`handleBuffered`). Gate:
 * `AGENT_TEST_DELAY_ENABLED`; per-execution key: `__test_delay_ms`; cap:
 * `AGENT_TEST_DELAY_MAX_MS` (hard-capped at 600_000).
 */
describe("ExecutionHandler — deterministic test delay hook (T02)", () => {
  const ENV_KEYS = [
    "AGENT_TEST_DELAY_ENABLED",
    "AGENT_TEST_DELAY_MAX_MS",
  ] as const;
  let originalEnv: Record<string, string | undefined>;

  let handler: ExecutionHandler;
  let mockChatService: { generateReply: ReturnType<typeof mock> };
  let mockJs: { publish: ReturnType<typeof mock> };
  let mockNc: {
    publish: ReturnType<typeof mock>;
    subscribe: ReturnType<typeof mock>;
  };

  const successReply = {
    text: "hello",
    usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    costUsd: 0.42,
    toolCalls: [{ type: "tool-call", toolName: "t", args: {} }],
    toolResults: [{ toolName: "t", args: {}, result: "ok", success: true }],
    model: "m-1",
    provider: "p-1",
  };

  function delayInput(
    executionId: string,
    delay: unknown,
    where: "variables" | "metadata" = "variables"
  ): Record<string, unknown> {
    const base = {
      executionId,
      agentId: "agent-1",
      message: "hi",
    };
    if (where === "variables") {
      return {
        input: {
          ...base,
          variables: {
            system: {},
            workflow: {},
            previous: {},
            node: {},
            request: { __test_delay_ms: delay },
          },
        },
      };
    }
    return {
      input: { ...base, metadata: { __test_delay_ms: delay } },
    };
  }

  function publishedPayload(kind: string): Record<string, unknown> | undefined {
    const call = mockJs.publish.mock.calls.find((c) =>
      (c[0] as string).includes(kind)
    );
    if (!call) {
      return undefined;
    }
    return JSON.parse(call[1] as string).data.payload;
  }

  beforeEach(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) {
      delete process.env[k];
    }

    mockChatService = {
      generateReply: mock(() => Promise.resolve(successReply)),
    };
    mockJs = { publish: mock(() => Promise.resolve()) };
    mockNc = {
      publish: mock(() => {}),
      subscribe: mock(() => ({ unsubscribe: mock(() => {}) })),
    };

    handler = new ExecutionHandler(
      mockChatService as unknown as ChatService,
      mockJs as unknown as JetStreamClient,
      mockNc as unknown as NatsConnection
    );
    handler.onModuleInit();
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

  it("applies the delay before generateReply when the gate is on and the key is present", async () => {
    process.env.AGENT_TEST_DELAY_ENABLED = "true";

    const startedAt = Date.now();
    await handler.handle("acme", delayInput("exec-delay-on", 120));
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(mockChatService.generateReply).toHaveBeenCalledTimes(1);
    expect(publishedPayload("execution_completed")?.state).toBe("completed");
  });

  it("also accepts the key from metadata", async () => {
    process.env.AGENT_TEST_DELAY_ENABLED = "true";

    const startedAt = Date.now();
    await handler.handle(
      "acme",
      delayInput("exec-delay-meta", 120, "metadata")
    );

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
    expect(publishedPayload("execution_completed")?.state).toBe("completed");
  });

  it("ignores the key entirely when the gate is off (production default)", async () => {
    // AGENT_TEST_DELAY_ENABLED unset → hook must be inert.
    const startedAt = Date.now();
    await handler.handle("acme", delayInput("exec-delay-off", 5_000));
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(1_000);
    expect(mockChatService.generateReply).toHaveBeenCalledTimes(1);
    expect(publishedPayload("execution_completed")?.state).toBe("completed");
  });

  /**
   * Regression: the first cut of the hook `await`ed an async no-op even with
   * the gate off, inserting an extra microtask hop before `generateReply` and
   * breaking `execution-handler-buffered.spec.ts`'s timeout test. The gate-off
   * path must reach `generateReply` within the SAME number of microtask ticks
   * as before the hook existed (one `await Promise.resolve()`).
   */
  it("does not add a microtask hop before generateReply when the gate is off", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockChatService.generateReply = mock(
      (
        _tenantId: string,
        _request: unknown,
        options: { abortSignal: AbortSignal }
      ) => {
        capturedSignal = options.abortSignal;
        return Promise.resolve(successReply);
      }
    );

    const handlePromise = handler.handle(
      "acme",
      delayInput("exec-delay-ordering", 5_000)
    );
    await Promise.resolve();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    await handlePromise;
  });

  it("clamps a delay above the cap instead of honoring it", async () => {
    process.env.AGENT_TEST_DELAY_ENABLED = "true";
    process.env.AGENT_TEST_DELAY_MAX_MS = "50";

    const startedAt = Date.now();
    await handler.handle("acme", delayInput("exec-delay-cap", 5_000_000));
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(2_000);
    expect(publishedPayload("execution_completed")?.state).toBe("completed");
  });

  it("ignores non-positive / non-numeric delay values", async () => {
    process.env.AGENT_TEST_DELAY_ENABLED = "true";

    await handler.handle("acme", delayInput("exec-delay-bad", "not-a-number"));
    await handler.handle("acme", delayInput("exec-delay-zero", 0));

    expect(mockChatService.generateReply).toHaveBeenCalledTimes(2);
  });

  it("does not swallow a generateReply error when the delay is applied", async () => {
    process.env.AGENT_TEST_DELAY_ENABLED = "true";
    mockChatService.generateReply = mock(() =>
      Promise.reject(new Error("llm exploded"))
    );

    await handler.handle("acme", delayInput("exec-delay-err", 20));

    const failed = publishedPayload("execution_failed");
    expect(failed?.state).toBe("failed");
    expect(failed?.error).toBe("llm exploded");
  });

  it("keeps the cancel path working during the delay (abort timer untouched)", async () => {
    process.env.AGENT_TEST_DELAY_ENABLED = "true";
    let cancelCallback:
      | ((error: Error | null, message: Msg) => void)
      | undefined;
    mockNc.subscribe = mock(
      (_subject: string, opts: { callback: typeof cancelCallback }) => {
        cancelCallback = opts.callback;
        return { unsubscribe: mock(() => {}) };
      }
    );
    handler = new ExecutionHandler(
      mockChatService as unknown as ChatService,
      mockJs as unknown as JetStreamClient,
      mockNc as unknown as NatsConnection
    );
    handler.onModuleInit();

    const handlePromise = handler.handle(
      "acme",
      delayInput("exec-delay-cancel", 60_000)
    );

    await Promise.resolve();
    await Promise.resolve();
    cancelCallback?.(null, {
      subject: "rt.acme.exec.exec-delay-cancel.cancel",
    } as Msg);

    await handlePromise;

    // The delay was interrupted by the abort — no LLM call, failed w/ cancelled.
    expect(mockChatService.generateReply).not.toHaveBeenCalled();
    const failed = publishedPayload("execution_failed");
    expect(failed?.reason).toBe("cancelled");
  });

  it("still publishes the full execution_completed payload contract after a delay", async () => {
    process.env.AGENT_TEST_DELAY_ENABLED = "true";

    await handler.handle("acme", delayInput("exec-delay-contract", 20));

    const payload = publishedPayload("execution_completed");
    expect(payload).toMatchObject({
      executionId: "exec-delay-contract",
      agentId: "agent-1",
      tenantId: "acme",
      state: "completed",
      response: successReply.text,
      usage: successReply.usage,
      costUsd: successReply.costUsd,
      toolCalls: successReply.toolCalls,
      toolResults: successReply.toolResults,
      model: successReply.model,
      provider: successReply.provider,
    });
  });
});
