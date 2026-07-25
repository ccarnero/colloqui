import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { Agent } from "../../src/modules/agents/agent.model";
import type { RuntimeState } from "../../src/modules/chat/chat.dto";
import { SessionChatService } from "../../src/modules/chat/session-chat.service";
import { LlmExecutorService } from "../../src/modules/llm/llm-executor.service";
import { MemoryClientService } from "../../src/modules/memory/memory-client.service";

// ── Fixtures ──────────────────────────────────────────────────────────────

const createMockAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: "agent-1",
  name: "TestAgent",
  description: "Test agent",
  systemPrompt: "You are helpful.",
  modelConfig: { provider: "openai", model: "gpt-4o" },
  tools: [],
  skills: [],
  rules: [],
  channels: [],
  ...overrides,
});

const createMockState = (
  overrides: Partial<RuntimeState> = {}
): RuntimeState => ({
  systemPrompt: "You are helpful.",
  rules: [],
  memoryContext: "",
  conversationHistory: [],
  availableTools: [],
  availableSkills: [],
  userMessage: "hi",
  runtimeContext: {},
  ...overrides,
});

const mockLlmResult = {
  text: "reply",
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  costUsd: 0,
  toolCalls: [],
  toolResults: [],
  model: "gpt-4o",
  provider: "openai",
};

// ── Suite ─────────────────────────────────────────────────────────────────
//
// Regression coverage for the modelConfig warn guard (backlog BUG B,
// 2026-07-24 agent-mcp-tool-naming loop): `agent.modelConfig` is valid in
// two shapes — flat (`{ provider, model }`) and nested (`{ llm: { provider,
// model } }`, see the `?? llm.provider` fallback in generateReply /
// generateStreamReply below). Before the fix, the warn guard only checked
// the flat fields, so a genuinely valid nested-only config falsely logged
// "has no modelConfig.provider/model" on every turn.
//
// `SessionChatService`'s `logger` is a private `new Logger(...)` field, not
// DI-injected, so it can't be swapped via the testing module.
// `Logger.prototype.warn` is also a `@nestjs/common` decorator-defined
// accessor property (bun's `spyOn` can't wrap it — "does not support
// accessor properties yet"), and several OTHER spec files in this suite
// permanently replace the whole `@nestjs/common` module via `mock.module`
// for the rest of the bun process (see memory.tool.spec.ts,
// llm-executor.service.spec.ts, etc.) — so a fresh `import { Logger }` in
// THIS file can resolve to a different class object than the one already
// cached inside `session-chat.service.ts` (which was first imported, and
// so bound its `Logger`, back when chat.service.spec.ts loaded the real
// module). Patching the concrete `logger` instance actually held by
// `service` sidesteps both problems entirely.

describe("SessionChatService — modelConfig warn guard (BUG B)", () => {
  let service: SessionChatService;
  let mockLlmExecutor: {
    generateText: ReturnType<typeof mock>;
    generateTextWithTools: ReturnType<typeof mock>;
    streamText: ReturnType<typeof mock>;
  };
  let mockMemoryClient: { create: ReturnType<typeof mock> };
  let warnCalls: unknown[][];
  let originalWarn: (...args: unknown[]) => void;
  let loggerInstance: { warn: (...args: unknown[]) => void };

  beforeEach(async () => {
    warnCalls = [];
    mockLlmExecutor = {
      generateText: mock(() => Promise.resolve(mockLlmResult)),
      generateTextWithTools: mock(() => Promise.resolve(mockLlmResult)),
      streamText: mock(() => Promise.resolve(mockLlmResult)),
    };
    mockMemoryClient = {
      create: mock(() => Promise.resolve({})),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SessionChatService,
        { provide: LlmExecutorService, useValue: mockLlmExecutor },
        { provide: MemoryClientService, useValue: mockMemoryClient },
      ],
    }).compile();

    service = moduleRef.get(SessionChatService);

    loggerInstance = (service as unknown as { logger: typeof loggerInstance })
      .logger;
    originalWarn = loggerInstance.warn.bind(loggerInstance);
    Object.defineProperty(loggerInstance, "warn", {
      value: (message?: unknown, ...optionalParams: unknown[]) => {
        warnCalls.push([message, ...optionalParams]);
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(loggerInstance, "warn", {
      value: originalWarn,
      writable: true,
      configurable: true,
    });
  });

  function modelConfigWarnings(): unknown[][] {
    return warnCalls.filter((c) =>
      String(c[0]).includes("has no modelConfig.provider/model")
    );
  }

  describe("generateReply", () => {
    it("does NOT warn when modelConfig uses the flat shape (provider/model at top level)", async () => {
      const agent = createMockAgent({
        modelConfig: { provider: "openai", model: "gpt-4o" },
      });

      await service.generateReply(
        "tenant-1",
        "session-1",
        agent,
        createMockState()
      );

      expect(modelConfigWarnings()).toHaveLength(0);
    });

    it("does NOT warn when modelConfig uses the nested `llm` shape (a genuinely valid config)", async () => {
      const agent = createMockAgent({
        modelConfig: { llm: { provider: "anthropic", model: "claude-3-opus" } },
      });

      await service.generateReply(
        "tenant-1",
        "session-1",
        agent,
        createMockState()
      );

      expect(modelConfigWarnings()).toHaveLength(0);
    });

    it("still warns when modelConfig has neither flat nor nested provider/model (genuinely misconfigured)", async () => {
      const agent = createMockAgent({ modelConfig: {} });

      await service.generateReply(
        "tenant-1",
        "session-1",
        agent,
        createMockState()
      );

      expect(modelConfigWarnings()).toHaveLength(1);
    });
  });

  describe("generateStreamReply", () => {
    it("does NOT warn when modelConfig uses the nested `llm` shape", async () => {
      const agent = createMockAgent({
        modelConfig: { llm: { provider: "anthropic", model: "claude-3-opus" } },
      });

      await service.generateStreamReply(
        "tenant-1",
        "session-2",
        agent,
        createMockState()
      );

      expect(modelConfigWarnings()).toHaveLength(0);
    });

    it("still warns when modelConfig is genuinely empty", async () => {
      const agent = createMockAgent({ modelConfig: {} });

      await service.generateStreamReply(
        "tenant-1",
        "session-2",
        agent,
        createMockState()
      );

      expect(modelConfigWarnings()).toHaveLength(1);
    });
  });
});
