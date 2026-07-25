import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { JetStreamClient } from "nats";

// ── Module Mocks ──────────────────────────────────────────────────────────
// PinoLoggerService is a field initializer, not constructor-injected, so it
// must be mocked before the import resolves (same pattern as
// execution-handler-buffered.spec.ts / execution-handler-streaming.spec.ts).
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

import type { ChatService } from "../../src/modules/chat/chat.service";
import { ChatHandler } from "../../src/nats-handlers/chat.handler";

/**
 * Regression coverage for BUG A (agent-ai-service playground system-variable
 * gap, recorded 2026-07-24 during the agent-mcp-tool-naming loop):
 * ChatHandler (the playground/test-execution path, action_type
 * `chat_respond`) built its ChatRequest without a `variables` field, so
 * `{{variables.*}}` placeholders never resolved in playground runs even
 * though ExecutionHandler (the published-agent runtime path,
 * `execution_requested`) already forwards `payload.variables` faithfully.
 * The fix mirrors ExecutionHandler's forwarding instead of duplicating
 * variable-resolution logic.
 */
describe("ChatHandler — forwards `variables` to ChatService (BUG A)", () => {
  let handler: ChatHandler;
  let mockChatService: { generateReply: ReturnType<typeof mock> };
  let mockJs: { publish: ReturnType<typeof mock> };

  beforeEach(() => {
    mockChatService = {
      generateReply: mock(() =>
        Promise.resolve({
          text: "hi",
          usage: { totalTokens: 1 },
        })
      ),
    };
    mockJs = { publish: mock(() => Promise.resolve()) };

    handler = new ChatHandler(
      mockChatService as unknown as ChatService,
      mockJs as unknown as JetStreamClient
    );
  });

  it("forwards payload.variables into the ChatRequest passed to chatService.generateReply", async () => {
    const variables = {
      system: { company_name: "Acme Corp" },
      workflow: {},
      previous: {},
      node: {},
      request: {},
    };

    await handler.handle("acme", {
      agentId: "agent-1",
      message: "hi",
      variables,
    });

    expect(mockChatService.generateReply).toHaveBeenCalledTimes(1);
    const [, request] = mockChatService.generateReply.mock.calls[0] as [
      string,
      { variables?: unknown },
    ];
    expect(request.variables).toEqual(variables);
  });

  it("leaves variables undefined when the payload has none (no crash, no fabricated value)", async () => {
    await handler.handle("acme", {
      agentId: "agent-1",
      message: "hi",
    });

    expect(mockChatService.generateReply).toHaveBeenCalledTimes(1);
    const [, request] = mockChatService.generateReply.mock.calls[0] as [
      string,
      { variables?: unknown },
    ];
    expect(request.variables).toBeUndefined();
  });
});
