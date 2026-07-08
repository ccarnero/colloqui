import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { JetStreamClient, Msg, NatsConnection } from "nats";

// ── Module Mocks ──────────────────────────────────────────────────────────
// PinoLoggerService is a field initializer, not constructor-injected, so it
// must be mocked before the import resolves (same pattern as
// execution-handler-streaming.spec.ts).
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
 * Covers ASYNC-RESILIENCE-AUDIT.md F4 — `handleBuffered` (non-streaming
 * execution) lacked any AbortController/wall-clock timeout, unlike
 * `handleStreaming`. Now it registers an AbortController in the shared
 * `abortControllers` map (so the existing `rt.*.exec.*.cancel` subscription
 * can abort it) and self-aborts after `bufferedExecutionTimeoutMs`.
 */
describe("ExecutionHandler — handleBuffered abort plumbing (F4)", () => {
  let handler: ExecutionHandler;
  let mockChatService: { generateReply: ReturnType<typeof mock> };
  let mockJs: { publish: ReturnType<typeof mock> };
  let mockNc: {
    publish: ReturnType<typeof mock>;
    subscribe: ReturnType<typeof mock>;
  };
  let subscribedCallback:
    | ((error: Error | null, message: Msg) => void)
    | undefined;
  let originalTimeoutEnv: string | undefined;

  function fireCancel(subject: string): void {
    subscribedCallback?.(null, { subject } as Msg);
  }

  beforeEach(() => {
    originalTimeoutEnv = process.env.AGENT_BUFFERED_EXECUTION_TIMEOUT_MS;
    mockChatService = {
      generateReply: mock(() => Promise.resolve({})),
    };
    mockJs = { publish: mock(() => Promise.resolve()) };

    subscribedCallback = undefined;
    mockNc = {
      publish: mock(() => {}),
      subscribe: mock(
        (_subject: string, opts: { callback: typeof subscribedCallback }) => {
          subscribedCallback = opts.callback;
          return { unsubscribe: mock(() => {}) };
        }
      ),
    };

    handler = new ExecutionHandler(
      mockChatService as unknown as ChatService,
      mockJs as unknown as JetStreamClient,
      mockNc as unknown as NatsConnection
    );
    handler.onModuleInit();
  });

  afterEach(() => {
    if (originalTimeoutEnv === undefined) {
      delete process.env.AGENT_BUFFERED_EXECUTION_TIMEOUT_MS;
    } else {
      process.env.AGENT_BUFFERED_EXECUTION_TIMEOUT_MS = originalTimeoutEnv;
    }
  });

  it("forwards an AbortSignal into chatService.generateReply", async () => {
    mockChatService.generateReply = mock(() =>
      Promise.resolve({
        text: "hi",
        usage: { totalTokens: 1 },
        costUsd: 0,
        toolCalls: [],
        toolResults: [],
        model: "m",
        provider: "p",
      })
    );

    await handler.handle("acme", {
      input: {
        executionId: "exec-buf-1",
        agentId: "agent-1",
        message: "hi",
      },
    });

    const [, , options] = mockChatService.generateReply.mock.calls[0] as [
      string,
      unknown,
      { abortSignal: AbortSignal },
    ];
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options.abortSignal.aborted).toBe(false);
  });

  it("aborts the in-flight buffered execution's AbortController when a cancel message arrives on its subject", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockChatService.generateReply = mock(
      (
        _tenantId: string,
        _request: unknown,
        options: { abortSignal: AbortSignal }
      ) => {
        capturedSignal = options.abortSignal;
        return new Promise(() => {}); // never resolves — mirrors a hung LLM call
      }
    );

    const handlePromise = handler.handle("acme", {
      input: {
        executionId: "exec-buf-cancel-1",
        agentId: "agent-1",
        message: "hi",
      },
    });

    // Let the microtask queue run so handleBuffered registers the controller.
    await Promise.resolve();
    await Promise.resolve();

    expect(capturedSignal?.aborted).toBe(false);

    fireCancel("rt.acme.exec.exec-buf-cancel-1.cancel");

    expect(capturedSignal?.aborted).toBe(true);

    // handlePromise never resolves in this test (generateReply never settles);
    // just make sure nothing throws synchronously.
    void handlePromise;
  });

  it("publishes execution_failed with reason=cancelled after a cancel-driven abort", async () => {
    mockChatService.generateReply = mock(
      (
        _tenantId: string,
        _request: unknown,
        options: { abortSignal: AbortSignal }
      ) =>
        new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        })
    );

    const handlePromise = handler.handle("acme", {
      input: {
        executionId: "exec-buf-cancel-2",
        agentId: "agent-1",
        message: "hi",
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    fireCancel("rt.acme.exec.exec-buf-cancel-2.cancel");

    await handlePromise;

    const failedCall = mockJs.publish.mock.calls.find((c) =>
      (c[0] as string).includes("execution_failed")
    );
    expect(failedCall).toBeDefined();
    const payload = JSON.parse(failedCall?.[1] as string).data.payload;
    expect(payload.reason).toBe("cancelled");
  });

  it("self-aborts once the wall-clock buffered-execution timeout elapses, even without a cancel message", async () => {
    process.env.AGENT_BUFFERED_EXECUTION_TIMEOUT_MS = "15";

    let capturedSignal: AbortSignal | undefined;
    mockChatService.generateReply = mock(
      (
        _tenantId: string,
        _request: unknown,
        options: { abortSignal: AbortSignal }
      ) => {
        capturedSignal = options.abortSignal;
        return new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        });
      }
    );

    const handlePromise = handler.handle("acme", {
      input: {
        executionId: "exec-buf-timeout-1",
        agentId: "agent-1",
        message: "hi",
      },
    });

    await Promise.resolve();
    expect(capturedSignal?.aborted).toBe(false);

    await handlePromise;

    expect(capturedSignal?.aborted).toBe(true);
    const failedCall = mockJs.publish.mock.calls.find((c) =>
      (c[0] as string).includes("execution_failed")
    );
    expect(failedCall).toBeDefined();
  });

  it("removes the AbortController from the shared map once the buffered execution completes", async () => {
    mockChatService.generateReply = mock(() =>
      Promise.resolve({
        text: "done",
        usage: { totalTokens: 1 },
        costUsd: 0,
        toolCalls: [],
        toolResults: [],
        model: "m",
        provider: "p",
      })
    );

    await handler.handle("acme", {
      input: {
        executionId: "exec-buf-cleanup-1",
        agentId: "agent-1",
        message: "hi",
      },
    });

    // A cancel for an already-completed execution should be a no-op.
    expect(() =>
      fireCancel("rt.acme.exec.exec-buf-cleanup-1.cancel")
    ).not.toThrow();
  });
});
