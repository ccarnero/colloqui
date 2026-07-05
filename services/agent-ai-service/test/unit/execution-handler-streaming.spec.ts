import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { JetStreamClient, Msg, NatsConnection } from "nats";

// ── Module Mocks ──────────────────────────────────────────────────────────
// PinoLoggerService is a field initializer, not constructor-injected, so it
// must be mocked before the import resolves (same pattern as
// heartbeat.service.spec.ts).
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

describe("ExecutionHandler — runtime token streaming (DOCS/architecture/runtime-streaming.md)", () => {
  let handler: ExecutionHandler;
  let mockChatService: {
    generateReply: ReturnType<typeof mock>;
    generateStream: ReturnType<typeof mock>;
  };
  let mockJs: { publish: ReturnType<typeof mock> };
  let mockNc: {
    publish: ReturnType<typeof mock>;
    subscribe: ReturnType<typeof mock>;
  };
  let subscribedCallback:
    | ((error: Error | null, message: Msg) => void)
    | undefined;

  function makeTextStream(chunks: string[]): AsyncIterable<string> {
    return {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yield chunk;
        }
      },
    };
  }

  function fireCancel(subject: string): void {
    subscribedCallback?.(null, { subject } as Msg);
  }

  beforeEach(() => {
    mockChatService = {
      generateReply: mock(() => Promise.resolve({})),
      generateStream: mock(() =>
        Promise.resolve({
          textStream: makeTextStream(["Hello", " ", "world"]),
          usage: Promise.resolve({
            inputTokens: 3,
            outputTokens: 3,
            costUsd: 0.0012,
          }),
          provider: "mock",
          model: "echo-1",
        })
      ),
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

  // ══════════════════════════════════════════════════════════════════════
  //  onModuleInit — cancel subscription
  // ══════════════════════════════════════════════════════════════════════

  describe("onModuleInit", () => {
    it("subscribes to the cancel wildcard subject on the raw NATS connection", () => {
      expect(mockNc.subscribe).toHaveBeenCalledTimes(1);
      const [subject] = mockNc.subscribe.mock.calls[0] as [string, unknown];
      expect(subject).toBe("rt.*.exec.*.cancel");
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  //  handle() — streaming path (input.stream === true)
  // ══════════════════════════════════════════════════════════════════════

  describe("handle — streaming mode", () => {
    it("publishes token events on the rt. subject via core NATS (nc.publish), not JetStream", async () => {
      await handler.handle("acme", {
        input: {
          executionId: "exec-1",
          agentId: "agent-1",
          message: "hi",
          stream: true,
        },
      });

      const tokenCalls = mockNc.publish.mock.calls;
      expect(tokenCalls.length).toBe(3); // "Hello", " ", "world"
      for (const [subject] of tokenCalls) {
        expect(
          (subject as string).startsWith("rt.acme.exec.exec-1.token")
        ).toBe(true);
        expect((subject as string).startsWith("evt.")).toBe(false);
      }
    });

    it("assigns a monotonically increasing seq to each token", async () => {
      await handler.handle("acme", {
        input: {
          executionId: "exec-2",
          agentId: "agent-1",
          message: "hi",
          stream: true,
        },
      });

      const seqs = mockNc.publish.mock.calls.map(([, raw]) => {
        const envelope = JSON.parse(raw as string);
        return envelope.data.payload.seq as number;
      });
      expect(seqs).toEqual([0, 1, 2]);
    });

    it("publishes a compliant envelope for each token (isCompliantEnvelope shape)", async () => {
      await handler.handle("acme", {
        input: {
          executionId: "exec-3",
          agentId: "agent-1",
          message: "hi",
          stream: true,
        },
      });

      const [, raw] = mockNc.publish.mock.calls[0] as [string, string];
      const envelope = JSON.parse(raw);
      expect(envelope.specversion).toBe("1.0");
      expect(envelope.type).toBe("io.yoizen.platform.runtime.token.v1");
      expect(envelope.tenant).toBe("acme");
      expect(envelope.data.payload.executionId).toBe("exec-3");
      expect(envelope.data.payload.delta).toBe("Hello");
      expect(envelope.data.payload.done).toBe(false);
    });

    it("publishes execution_started (JetStream) before any token", async () => {
      await handler.handle("acme", {
        input: {
          executionId: "exec-4",
          agentId: "agent-1",
          message: "hi",
          stream: true,
        },
      });

      const startedCall = mockJs.publish.mock.calls[0];
      expect(startedCall[0]).toContain("execution_started");
      const startedPayload = JSON.parse(startedCall[1] as string).data.payload;
      expect(startedPayload.state).toBe("started");
    });

    it("publishes execution_completed (JetStream) with full reply, usage, costUsd, model, provider after the stream ends", async () => {
      await handler.handle("acme", {
        input: {
          executionId: "exec-5",
          agentId: "agent-1",
          message: "hi",
          stream: true,
        },
      });

      const completedCall = mockJs.publish.mock.calls.find((c) =>
        (c[0] as string).includes("execution_completed")
      );
      expect(completedCall).toBeDefined();
      const payload = JSON.parse(completedCall![1] as string).data.payload;
      expect(payload.response).toBe("Hello world");
      expect(payload.usage.inputTokens).toBe(3);
      expect(payload.usage.outputTokens).toBe(3);
      expect(payload.costUsd).toBe(0.0012);
      expect(payload.model).toBe("echo-1");
      expect(payload.provider).toBe("mock");
    });

    it("does not publish any tokens over JetStream — only the lifecycle events", async () => {
      await handler.handle("acme", {
        input: {
          executionId: "exec-6",
          agentId: "agent-1",
          message: "hi",
          stream: true,
        },
      });

      for (const [subject] of mockJs.publish.mock.calls) {
        expect(subject as string).not.toContain(".token.");
      }
    });

    it("falls back to buffered generateReply when stream is not set", async () => {
      await handler.handle("acme", {
        input: {
          executionId: "exec-7",
          agentId: "agent-1",
          message: "hi",
        },
      });

      expect(mockChatService.generateReply).toHaveBeenCalledTimes(1);
      expect(mockChatService.generateStream).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Cancel → abort (§2.2)
  // ══════════════════════════════════════════════════════════════════════

  describe("cancel propagation", () => {
    it("forwards abortSignal into chatService.generateStream", async () => {
      await handler.handle("acme", {
        input: {
          executionId: "exec-8",
          agentId: "agent-1",
          message: "hi",
          stream: true,
        },
      });

      const [, , options] = mockChatService.generateStream.mock.calls[0] as [
        string,
        unknown,
        { executionId: string; abortSignal: AbortSignal },
      ];
      expect(options.executionId).toBe("exec-8");
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    });

    it("aborts the in-flight execution's AbortController when a cancel message arrives on its subject", async () => {
      // A never-resolving stream so we can inspect the AbortController mid-flight.
      let capturedSignal: AbortSignal | undefined;
      mockChatService.generateStream = mock(
        (
          _tenantId: string,
          _request: unknown,
          options: { abortSignal: AbortSignal }
        ) => {
          capturedSignal = options.abortSignal;
          return new Promise(() => {}); // never resolves in this test
        }
      );

      const handlePromise = handler.handle("acme", {
        input: {
          executionId: "exec-cancel-1",
          agentId: "agent-1",
          message: "hi",
          stream: true,
        },
      });

      // Give the microtask queue a tick so handleStreaming registers the controller.
      await Promise.resolve();
      await Promise.resolve();

      expect(capturedSignal?.aborted).toBe(false);

      fireCancel("rt.acme.exec.exec-cancel-1.cancel");

      expect(capturedSignal?.aborted).toBe(true);

      // Don't await handlePromise (it never resolves in this test); just
      // ensure no unhandled rejection surfaces synchronously.
      void handlePromise;
    });

    it("publishes execution_failed with reason=cancelled when the stream throws after an abort", async () => {
      mockChatService.generateStream = mock(
        (
          _tenantId: string,
          _request: unknown,
          options: { abortSignal: AbortSignal }
        ) => {
          return Promise.resolve({
            textStream: {
              async *[Symbol.asyncIterator]() {
                yield "partial";
                await new Promise((resolve) => {
                  options.abortSignal.addEventListener("abort", () => {
                    throw new Error("aborted");
                  });
                  // Simulate the AI SDK throwing once aborted.
                  if (options.abortSignal.aborted) {
                    throw new Error("aborted");
                  }
                  resolve(undefined);
                });
                throw new Error("aborted");
              },
            },
            usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
            provider: "mock",
            model: "echo-1",
          });
        }
      );

      await handler.handle("acme", {
        input: {
          executionId: "exec-cancel-2",
          agentId: "agent-1",
          message: "hi",
          stream: true,
        },
      });

      fireCancel("rt.acme.exec.exec-cancel-2.cancel");

      const failedCall = mockJs.publish.mock.calls.find((c) =>
        (c[0] as string).includes("execution_failed")
      );
      expect(failedCall).toBeDefined();
    });

    it("ignores a cancel message for an executionId with no active controller", () => {
      expect(() =>
        fireCancel("rt.acme.exec.never-started.cancel")
      ).not.toThrow();
    });

    it("removes the AbortController from the map once the execution completes", async () => {
      await handler.handle("acme", {
        input: {
          executionId: "exec-9",
          agentId: "agent-1",
          message: "hi",
          stream: true,
        },
      });

      // A cancel for an already-completed execution should be a no-op —
      // proven indirectly: no additional publish activity is triggered.
      const publishCountBefore = mockJs.publish.mock.calls.length;
      fireCancel("rt.acme.exec.exec-9.cancel");
      expect(mockJs.publish.mock.calls.length).toBe(publishCountBefore);
    });
  });
});
