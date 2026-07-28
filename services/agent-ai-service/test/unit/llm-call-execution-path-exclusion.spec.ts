import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { JetStreamClient, NatsConnection } from "nats";

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
 * Regression test for `manual-loops/connectors/connection-call-inspector.md`
 * T04's exclusion rule: chat executions (`execution.handler.ts`) already
 * carry their full payload in `execution_completed` and must NOT ALSO get an
 * `ai.llm_call.completed.v1` event — that event is exclusively emitted by
 * the job-executor's standalone LLM path (`llm-action.service.ts`), which
 * `ExecutionHandler` never touches.
 */
describe("ExecutionHandler — chat execution path never emits ai.llm_call.completed.v1 (T04 exclusion)", () => {
  let handler: ExecutionHandler;
  let mockChatService: { generateReply: ReturnType<typeof mock> };
  let mockJs: { publish: ReturnType<typeof mock> };
  let mockNc: {
    publish: ReturnType<typeof mock>;
    subscribe: ReturnType<typeof mock>;
  };

  beforeEach(() => {
    mockChatService = {
      generateReply: mock(() =>
        Promise.resolve({
          text: "reply",
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          costUsd: 0.001,
          toolCalls: [],
          toolResults: [],
          model: "gpt-4o",
          provider: "openai",
        })
      ),
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

  it("publishes execution_completed but never an ai.llm_call.completed.v1 event", async () => {
    await handler.handle("acme", {
      input: {
        executionId: "exec-chat-1",
        agentId: "agent-1",
        message: "hi",
      },
    });

    const completedCall = mockJs.publish.mock.calls.find((c) =>
      (c[0] as string).includes("execution_completed")
    );
    expect(completedCall).toBeDefined();

    const llmCallEvent = mockJs.publish.mock.calls.find((c) => {
      const [subject, body] = c as [string, string];
      if (subject.includes("llm_call")) {
        return true;
      }
      try {
        return JSON.parse(body).type === "ai.llm_call.completed.v1";
      } catch {
        return false;
      }
    });
    expect(llmCallEvent).toBeUndefined();
  });
});
