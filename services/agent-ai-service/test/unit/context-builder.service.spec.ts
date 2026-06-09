import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { ContextBuilderService } from "../../src/modules/chat/context-builder.service";
import { MemoryContextBuilderService } from "../../src/modules/memory/memory-context-builder.service";
import type { Agent } from "../../src/modules/agents/agent.model";
import type { ChatContextMessage } from "../../src/modules/chat/chat.dto";
import type { MemoryContext } from "../../src/modules/memory/memory-context-builder.service";

// ── Fixtures ──────────────────────────────────────────────────────────────

const createMockAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: "agent-1",
  name: "TestAgent",
  description: "A test agent",
  systemPrompt: "You are {{agent.name}}",
  modelConfig: { provider: "openai", model: "gpt-4o" },
  tools: [{ name: "search" }],
  skills: [{ name: "deploy" }],
  rules: [{ type: "always_reply_in_spanish" }],
  channels: [],
  ...overrides,
});

const MEMORY_CONTEXT_STUB: MemoryContext = {
  summary: "User likes coffee",
  items: [{ title: "Preference", content: "Likes coffee" }],
  raw: {},
};

const FORMATTED_MEMORY_STUB = "Tenant memory summary:\nUser likes coffee";

// ── Mock ───────────────────────────────────────────────────────────────────

const mockMemoryContextBuilder = {
  buildContext: mock(() => Promise.resolve(MEMORY_CONTEXT_STUB)),
  formatForPrompt: mock(() => FORMATTED_MEMORY_STUB),
};

// ── Suite ──────────────────────────────────────────────────────────────────

describe("ContextBuilderService", () => {
  let service: ContextBuilderService;

  beforeEach(async () => {
    mockMemoryContextBuilder.buildContext.mockImplementation(() =>
      Promise.resolve(MEMORY_CONTEXT_STUB),
    );
    mockMemoryContextBuilder.formatForPrompt.mockImplementation(
      () => FORMATTED_MEMORY_STUB,
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ContextBuilderService,
        {
          provide: MemoryContextBuilderService,
          useValue: mockMemoryContextBuilder,
        },
      ],
    }).compile();

    service = moduleRef.get(ContextBuilderService);
  });

  // ── buildRuntimeState ─────────────────────────────────────────────────

  describe("buildRuntimeState", () => {
    it("returns systemPrompt from agent", async () => {
      const agent = createMockAgent({
        systemPrompt: "Custom prompt {{agent.name}}",
      });
      const state = await service.buildRuntimeState("t1", agent, "hi");

      expect(state.systemPrompt).toBe("Custom prompt {{agent.name}}");
    });

    it("returns rules from agent", async () => {
      const rules = [{ type: "rule_a" }, { type: "rule_b" }];
      const agent = createMockAgent({ rules });
      const state = await service.buildRuntimeState("t1", agent, "hi");

      expect(state.rules).toBe(rules);
    });

    it("returns availableTools from agent", async () => {
      const tools = [{ name: "tool1" }, { name: "tool2" }];
      const agent = createMockAgent({ tools });
      const state = await service.buildRuntimeState("t1", agent, "hi");

      expect(state.availableTools).toBe(tools);
    });

    it("returns availableSkills from agent", async () => {
      const skills = [{ name: "skill1" }];
      const agent = createMockAgent({ skills });
      const state = await service.buildRuntimeState("t1", agent, "hi");

      expect(state.availableSkills).toBe(skills);
    });

    it("returns userMessage equal to input message", async () => {
      const agent = createMockAgent();
      const state = await service.buildRuntimeState("t1", agent, "hello world");

      expect(state.userMessage).toBe("hello world");
    });

    it("calls memoryContextBuilder.buildContext with tenantId, agentId, message", async () => {
      const agent = createMockAgent({ id: "my-agent" });
      await service.buildRuntimeState("tenant-42", agent, "what is X?");

      expect(mockMemoryContextBuilder.buildContext).toHaveBeenCalledWith(
        "tenant-42",
        "my-agent",
        "what is X?",
      );
    });

    it("sets memoryContext to formatForPrompt result", async () => {
      mockMemoryContextBuilder.formatForPrompt.mockImplementation(() =>
        "Formatted memory text",
      );
      const agent = createMockAgent();
      const state = await service.buildRuntimeState("t1", agent, "hi");

      expect(state.memoryContext).toBe("Formatted memory text");
    });

    // ── conversationHistory ─────────────────────────────────────────────

    it("returns empty conversationHistory when no context provided", async () => {
      const agent = createMockAgent();
      const state = await service.buildRuntimeState("t1", agent, "hi");

      expect(state.conversationHistory).toEqual([]);
    });

    it("returns empty conversationHistory when context is empty array", async () => {
      const agent = createMockAgent();
      const state = await service.buildRuntimeState(
        "t1",
        agent,
        "hi",
        [],
      );

      expect(state.conversationHistory).toEqual([]);
    });

    it('maps sender "customer" to role "user"', async () => {
      const agent = createMockAgent();
      const context: ChatContextMessage[] = [
        { sender: "customer", content: "I need help", createdAt: "2025-01-01T00:00:00Z" },
      ];

      const state = await service.buildRuntimeState("t1", agent, "hi", context);

      expect(state.conversationHistory).toEqual([
        { role: "user", content: "I need help", timestamp: "2025-01-01T00:00:00Z" },
      ]);
    });

    it('maps sender "agent" to role "assistant"', async () => {
      const agent = createMockAgent();
      const context: ChatContextMessage[] = [
        { sender: "agent", content: "Sure thing", createdAt: "2025-01-01T00:01:00Z" },
      ];

      const state = await service.buildRuntimeState("t1", agent, "hi", context);

      expect(state.conversationHistory).toEqual([
        { role: "assistant", content: "Sure thing", timestamp: "2025-01-01T00:01:00Z" },
      ]);
    });

    it('maps sender "bot" to role "assistant"', async () => {
      const agent = createMockAgent();
      const context: ChatContextMessage[] = [
        { sender: "bot", content: "Beep boop", createdAt: "2025-01-01T00:02:00Z" },
      ];

      const state = await service.buildRuntimeState("t1", agent, "hi", context);

      expect(state.conversationHistory).toEqual([
        { role: "assistant", content: "Beep boop", timestamp: "2025-01-01T00:02:00Z" },
      ]);
    });

    it("uses current ISO date when createdAt is missing", async () => {
      const agent = createMockAgent();
      const context: ChatContextMessage[] = [
        { sender: "customer", content: "no timestamp" },
      ];

      const before = new Date().toISOString();
      const state = await service.buildRuntimeState("t1", agent, "hi", context);
      const after = new Date().toISOString();

      const ts = state.conversationHistory[0].timestamp;
      expect(ts >= before).toBe(true);
      expect(ts <= after).toBe(true);
    });

    it("maps multiple context messages preserving order", async () => {
      const agent = createMockAgent();
      const context: ChatContextMessage[] = [
        { sender: "customer", content: "Q1", createdAt: "2025-01-01T00:00:00Z" },
        { sender: "agent", content: "A1", createdAt: "2025-01-01T00:01:00Z" },
        { sender: "customer", content: "Q2", createdAt: "2025-01-01T00:02:00Z" },
        { sender: "bot", content: "A2", createdAt: "2025-01-01T00:03:00Z" },
      ];

      const state = await service.buildRuntimeState("t1", agent, "hi", context);

      expect(state.conversationHistory).toEqual([
        { role: "user", content: "Q1", timestamp: "2025-01-01T00:00:00Z" },
        { role: "assistant", content: "A1", timestamp: "2025-01-01T00:01:00Z" },
        { role: "user", content: "Q2", timestamp: "2025-01-01T00:02:00Z" },
        { role: "assistant", content: "A2", timestamp: "2025-01-01T00:03:00Z" },
      ]);
    });

    // ── runtimeContext ──────────────────────────────────────────────────

    it("includes tenantId and agentId in runtimeContext", async () => {
      const agent = createMockAgent({ id: "agent-x" });
      const state = await service.buildRuntimeState("tenant-99", agent, "msg");

      expect(state.runtimeContext.tenantId).toBe("tenant-99");
      expect(state.runtimeContext.agentId).toBe("agent-x");
    });

    it("includes customerMessage equal to input message", async () => {
      const agent = createMockAgent();
      const state = await service.buildRuntimeState("t1", agent, "what's up?");

      expect(state.runtimeContext.customerMessage).toBe("what's up?");
    });

    it("includes input.message and input.user_prompt both set to message", async () => {
      const agent = createMockAgent();
      const state = await service.buildRuntimeState("t1", agent, "test input");

      expect(state.runtimeContext.input).toEqual({
        message: "test input",
        user_prompt: "test input",
      });
    });

    it("includes agent info (id, name, description) in runtimeContext", async () => {
      const agent = createMockAgent({
        id: "a1",
        name: "SalesBot",
        description: "Helps with sales",
      });
      const state = await service.buildRuntimeState("t1", agent, "hi");

      expect(state.runtimeContext.agent).toEqual({
        id: "a1",
        name: "SalesBot",
        description: "Helps with sales",
      });
    });

    it("merges extra fields into runtimeContext", async () => {
      const agent = createMockAgent();
      const extra = {
        conversationId: "conv-123",
        chatId: "chat-456",
        userId: "user-789",
      };

      const state = await service.buildRuntimeState(
        "t1",
        agent,
        "hi",
        undefined,
        extra,
      );

      expect(state.runtimeContext.conversationId).toBe("conv-123");
      expect(state.runtimeContext.chatId).toBe("chat-456");
      expect(state.runtimeContext.userId).toBe("user-789");
    });

    it("extra fields override defaults when keys collide", async () => {
      const agent = createMockAgent();
      const extra = { tenantId: "overridden-tenant" };

      const state = await service.buildRuntimeState(
        "t1",
        agent,
        "hi",
        undefined,
        extra,
      );

      // ...extra spreads last, so it overrides the base tenantId
      expect(state.runtimeContext.tenantId).toBe("overridden-tenant");
    });

    it("builds conversationHistory string in runtimeContext as 'User: ...\\nAssistant: ...'", async () => {
      const agent = createMockAgent();
      const context: ChatContextMessage[] = [
        { sender: "customer", content: "Hello" },
        { sender: "agent", content: "Hi there" },
        { sender: "customer", content: "Help me" },
      ];

      const state = await service.buildRuntimeState("t1", agent, "msg", context);

      expect(state.runtimeContext.conversationHistory).toBe(
        "User: Hello\nAssistant: Hi there\nUser: Help me",
      );
    });

    it("returns empty string conversationHistory in runtimeContext when no context", async () => {
      const agent = createMockAgent();
      const state = await service.buildRuntimeState("t1", agent, "msg");

      expect(state.runtimeContext.conversationHistory).toBe("");
    });

    it("includes empty context and memory objects in runtimeContext", async () => {
      const agent = createMockAgent();
      const state = await service.buildRuntimeState("t1", agent, "msg");

      expect(state.runtimeContext.context).toEqual({});
      expect(state.runtimeContext.memory).toEqual({});
    });
  });
});
