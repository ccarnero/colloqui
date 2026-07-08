import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { Agent } from "../../src/modules/agents/agent.model";
import { AgentManagerService } from "../../src/modules/agents/agent-manager.service";
import type {
  ChatRequest,
  ChatResponse,
  RuntimeState,
} from "../../src/modules/chat/chat.dto";
import { ChatService } from "../../src/modules/chat/chat.service";
import { ContextBuilderService } from "../../src/modules/chat/context-builder.service";
import { SessionChatService } from "../../src/modules/chat/session-chat.service";
import { LlmExecutorService } from "../../src/modules/llm/llm-executor.service";
import type {
  SkillDefinition,
  SkillResult,
} from "../../src/modules/skills/skill-definition";
import type { SkillExecutionParams } from "../../src/modules/skills/skill-executor.service";
import { SkillExecutorService } from "../../src/modules/skills/skill-executor.service";
import { SkillRouterService } from "../../src/modules/skills/skill-router.service";
import { TemplateRendererService } from "../../src/modules/template-renderer/template-renderer.service";
import { McpConnectionService } from "../../src/modules/tools/mcp-connection.service";
import { ToolBridgeService } from "../../src/modules/tools/tool-bridge.service";

// ── Fixtures ──────────────────────────────────────────────────────────────

const createMockAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: "agent-1",
  name: "TestAgent",
  description: "Test agent",
  systemPrompt: "Hello {{agent.name}}, you help with {{input.message}}",
  modelConfig: { provider: "openai", model: "gpt-4o" },
  tools: [],
  skills: [],
  rules: [],
  channels: [],
  ...overrides,
});

const deploySkill: SkillDefinition = {
  id: "skill-1",
  name: "deploy",
  description: "deploy application to production",
  whenToUse: "when user wants to deploy",
  triggers: ["/deploy"],
  priority: 10,
  enabled: true,
  arguments: ["env", "version"],
  instructions: "Deploy the application following the standard procedure.",
  allowedTools: [],
};

const pricingSkill: SkillDefinition = {
  id: "skill-2",
  name: "pricing",
  description: "pricing information",
  whenToUse: "when user asks about pricing",
  triggers: ["/pricing"],
  priority: 5,
  enabled: true,
  arguments: [],
  instructions: "Provide pricing information.",
  allowedTools: [],
};

const disabledSkill: SkillDefinition = {
  id: "skill-3",
  name: "legacy",
  description: "Legacy disabled skill",
  whenToUse: "Should never be routed",
  triggers: ["/legacy"],
  priority: 0,
  enabled: false,
  arguments: [],
  instructions: "Legacy instructions.",
  allowedTools: [],
};

const createMockState = (
  overrides: Partial<RuntimeState> = {}
): RuntimeState => ({
  systemPrompt: "Hello {{agent.name}}",
  rules: [],
  memoryContext: "",
  conversationHistory: [],
  availableTools: [],
  availableSkills: [],
  userMessage: "I need help",
  runtimeContext: {
    tenantId: "tenant-1",
    agentId: "agent-1",
    input: { message: "I need help" },
    agent: { id: "agent-1", name: "TestAgent" },
  },
  ...overrides,
});

const baseRequest: ChatRequest = {
  agentId: "agent-1",
  message: "I need help",
};

const mockChatResponse: ChatResponse = {
  text: "Hello! How can I help you?",
  agentId: "agent-1",
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
};

// ── Mock Factories ────────────────────────────────────────────────────────

let service: ChatService;
let mockAgentManager: { getAgent: ReturnType<typeof mock> };
let mockContextBuilder: { buildRuntimeState: ReturnType<typeof mock> };
let mockSessionChat: {
  generateReply: ReturnType<typeof mock>;
  generateStreamReply: ReturnType<typeof mock>;
};
let mockLlmExecutor: { streamTextRaw: ReturnType<typeof mock> };
let mockTemplateRenderer: { renderPromptText: ReturnType<typeof mock> };
let mockSkillRouter: {
  setSkills: ReturnType<typeof mock>;
  findSkill: ReturnType<typeof mock>;
  getSkillSummariesForLlm: ReturnType<typeof mock>;
};
let mockSkillExecutor: { executeInline: ReturnType<typeof mock> };
let mockToolBridge: {
  toAiSdkToolsForAgent: ReturnType<typeof mock>;
  toAiSdkTools: ReturnType<typeof mock>;
};
let mockMcpConnection: {
  connectAllServers: ReturnType<typeof mock>;
  connectForTenant: ReturnType<typeof mock>;
};

const setupTestingModule = async (): Promise<void> => {
  mockAgentManager = {
    getAgent: mock(() => Promise.resolve(createMockAgent())),
  };
  mockContextBuilder = {
    buildRuntimeState: mock(() => Promise.resolve(createMockState())),
  };
  mockSessionChat = {
    generateReply: mock(() => Promise.resolve(mockChatResponse)),
    generateStreamReply: mock(() => Promise.resolve(mockChatResponse)),
  };
  mockLlmExecutor = {
    streamTextRaw: mock(() =>
      Promise.resolve({
        text: "streamed response",
        usage: { inputTokens: 5, outputTokens: 15, totalTokens: 20 },
      })
    ),
  };
  // Default: renderPromptText passes through the template unchanged
  mockTemplateRenderer = {
    renderPromptText: mock((template: string) => template),
  };
  mockSkillRouter = {
    setSkills: mock(() => {}),
    findSkill: mock(() => null),
    getSkillSummariesForLlm: mock(() => "No skills available."),
  };
  mockSkillExecutor = {
    executeInline: mock(() =>
      Promise.resolve({
        success: true,
        skillName: "deploy",
        skillId: "skill-1",
        executionMode: "inline",
        processedInstructions: "Skill instructions here",
        output: undefined,
        warnings: [],
      } satisfies SkillResult)
    ),
  };
  mockToolBridge = {
    toAiSdkToolsForAgent: mock(() => ({
      testTool: {
        description: "A test tool",
        parameters: {},
        execute: async () => "result",
      },
    })),
    toAiSdkTools: mock(() => ({
      testTool: {
        description: "A test tool",
        parameters: {},
        execute: async () => "result",
      },
    })),
  };
  mockMcpConnection = {
    connectAllServers: mock(() => Promise.resolve()),
    connectForTenant: mock(() => Promise.resolve()),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ChatService,
      { provide: AgentManagerService, useValue: mockAgentManager },
      { provide: ContextBuilderService, useValue: mockContextBuilder },
      { provide: SessionChatService, useValue: mockSessionChat },
      { provide: LlmExecutorService, useValue: mockLlmExecutor },
      { provide: TemplateRendererService, useValue: mockTemplateRenderer },
      { provide: SkillRouterService, useValue: mockSkillRouter },
      { provide: SkillExecutorService, useValue: mockSkillExecutor },
      { provide: ToolBridgeService, useValue: mockToolBridge },
      { provide: McpConnectionService, useValue: mockMcpConnection },
    ],
  }).compile();

  service = moduleRef.get(ChatService);
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ChatService", () => {
  beforeEach(async () => {
    await setupTestingModule();
  });

  // ────────────────────────────────────────────────────────────────────────
  // generateReply — agent not found
  // ────────────────────────────────────────────────────────────────────────

  describe("generateReply", () => {
    it("should throw NotFoundException when agent is not found", async () => {
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(null)
      );

      const request: ChatRequest = { agentId: "missing-agent", message: "hi" };

      try {
        await service.generateReply("tenant-1", request);
        expect(true).toBe(false); // should not reach here
      } catch (error: unknown) {
        expect((error as { message: string }).message).toContain(
          "Agent 'missing-agent' not found"
        );
        expect((error as { status?: number }).status).toBe(404);
      }
    });

    it("should throw NotFoundException with tenant info when agent is missing", async () => {
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(null)
      );

      const request: ChatRequest = { agentId: "x", message: "hi" };

      try {
        await service.generateReply("tenant-acme", request);
        expect(true).toBe(false);
      } catch (error: unknown) {
        expect((error as { message: string }).message).toContain(
          "tenant 'tenant-acme'"
        );
      }
    });

    // ──────────────────────────────────────────────────────────────────────
    // generateReply — no templates, no skills (passthrough)
    // ──────────────────────────────────────────────────────────────────────

    it("should pass renderedSystemPrompt to sessionChat when no skills", async () => {
      const agent = createMockAgent({
        systemPrompt: "You are a helpful assistant.",
        skills: [],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      const state = createMockState({
        systemPrompt: "You are a helpful assistant.",
      });
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(state)
      );
      // renderPromptText returns the same text (no placeholders)
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );

      await service.generateReply("tenant-1", baseRequest);

      // sessionChat.generateReply called
      expect(mockSessionChat.generateReply).toHaveBeenCalled();
      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      expect(passedState.renderedSystemPrompt).toBe(
        "You are a helpful assistant."
      );
    });

    it("should not call skillRouter.setSkills when agent has no skills", async () => {
      const agent = createMockAgent({ skills: [] });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState())
      );

      await service.generateReply("tenant-1", baseRequest);

      expect(mockSkillRouter.setSkills).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────────────────────
    // generateReply — with session → delegates to sessionChat
    // ──────────────────────────────────────────────────────────────────────

    it("should delegate to sessionChat.generateReply when sessionId is provided", async () => {
      const request: ChatRequest = {
        agentId: "agent-1",
        message: "hi",
        sessionId: "session-abc",
      };

      const result = await service.generateReply("tenant-1", request);

      expect(mockSessionChat.generateReply).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockChatResponse);
    });

    it("should pass tenantId, sessionId, agent, and state to sessionChat", async () => {
      const agent = createMockAgent();
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      const state = createMockState();
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(state)
      );

      const request: ChatRequest = {
        agentId: "agent-1",
        message: "hi",
        sessionId: "session-xyz",
      };

      await service.generateReply("tenant-1", request);

      const call = mockSessionChat.generateReply.mock.calls[0];
      expect(call[0]).toBe("tenant-1");
      expect(call[1]).toBe("session-xyz");
      expect(call[2]).toBe(agent);
      expect(call[3]).toBeDefined();
    });

    // ──────────────────────────────────────────────────────────────────────
    // generateReply — no session → delegates to sessionChat with auto-generated sessionId
    // ──────────────────────────────────────────────────────────────────────

    it("should delegate to sessionChat.generateReply with auto-generated sessionId when no sessionId provided", async () => {
      const result = await service.generateReply("tenant-1", baseRequest);

      expect(mockSessionChat.generateReply).toHaveBeenCalledTimes(1);
      const call = mockSessionChat.generateReply.mock.calls[0];
      expect(call[1]).toMatch(/^chat-agent-1-\d+$/);
      expect(result).toEqual(mockChatResponse);
    });

    // ──────────────────────────────────────────────────────────────────────
    // generateReply — extra fields propagated to contextBuilder
    // ──────────────────────────────────────────────────────────────────────

    it("should pass extra fields (conversationId, chatId, userId, customerName, channel) to contextBuilder", async () => {
      const request: ChatRequest = {
        agentId: "agent-1",
        message: "hi",
        conversationId: "conv-1",
        chatId: "chat-1",
        userId: "user-1",
        customerName: "Alice",
        channel: "whatsapp",
      };

      await service.generateReply("tenant-1", request);

      const call = mockContextBuilder.buildRuntimeState.mock.calls[0];
      // call signature: (tenantId, agent, message, context, extra)
      const extra = call[4] as Record<string, unknown>;
      expect(extra.conversationId).toBe("conv-1");
      expect(extra.chatId).toBe("chat-1");
      expect(extra.userId).toBe("user-1");
      expect(extra.customerName).toBe("Alice");
      expect(extra.channel).toBe("whatsapp");
    });

    it("should not include extra fields when request has none", async () => {
      const request: ChatRequest = {
        agentId: "agent-1",
        message: "hi",
        // no conversationId, chatId, userId, customerName, channel
      };

      await service.generateReply("tenant-1", request);

      const call = mockContextBuilder.buildRuntimeState.mock.calls[0];
      const extra = call[4] as Record<string, unknown>;
      // extra should be empty object since no optional fields provided
      expect(Object.keys(extra)).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // generateStreamReply
  // ────────────────────────────────────────────────────────────────────────

  describe("generateStreamReply", () => {
    it("should throw NotFoundException when agent is not found", async () => {
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(null)
      );

      try {
        await service.generateStreamReply("tenant-1", {
          agentId: "missing",
          message: "hi",
        });
        expect(true).toBe(false);
      } catch (error: unknown) {
        expect((error as { status?: number }).status).toBe(404);
      }
    });

    it("should call preparePrompt and pass renderedSystemPrompt to sessionChat", async () => {
      const agent = createMockAgent({
        systemPrompt: "Hello {{agent.name}}",
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      const state = createMockState({
        systemPrompt: "Hello {{agent.name}}",
      });
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(state)
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        () => "Hello TestAgent"
      );

      await service.generateStreamReply("tenant-1", {
        agentId: "agent-1",
        message: "hi",
        sessionId: "stream-session",
      });

      expect(mockSessionChat.generateStreamReply).toHaveBeenCalled();
      const callArgs = mockSessionChat.generateStreamReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      expect(passedState.renderedSystemPrompt).toBe("Hello TestAgent");
    });

    it("should use a generated sessionId when none provided", async () => {
      const agent = createMockAgent();
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState())
      );

      await service.generateStreamReply("tenant-1", {
        agentId: "agent-1",
        message: "hi",
        // no sessionId — should default to stream-{timestamp}
      });

      const call = mockSessionChat.generateStreamReply.mock.calls[0];
      const sessionId = call[1] as string;
      expect(sessionId).toMatch(/^stream-\d+$/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // generateStream
  // ────────────────────────────────────────────────────────────────────────

  describe("generateStream", () => {
    it("should throw NotFoundException when agent is not found", async () => {
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(null)
      );

      try {
        await service.generateStream("tenant-1", {
          agentId: "missing",
          message: "hi",
        });
        expect(true).toBe(false);
      } catch (error: unknown) {
        expect((error as { status?: number }).status).toBe(404);
      }
    });

    it("should use renderedSystemPrompt as systemPrompt for llmExecutor", async () => {
      const agent = createMockAgent({
        systemPrompt: "System: {{agent.name}}",
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      const state = createMockState({
        systemPrompt: "System: {{agent.name}}",
      });
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(state)
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        () => "System: TestAgent rendered"
      );

      await service.generateStream("tenant-1", {
        agentId: "agent-1",
        message: "hi",
      });

      const call = mockLlmExecutor.streamTextRaw.mock.calls[0];
      const params = call[0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const systemMessage = params.messages[0];
      expect(systemMessage.role).toBe("system");
      expect(systemMessage.content).toBe("System: TestAgent rendered");
    });

    it("should pass agent modelConfig to llmExecutor with provider and model", async () => {
      const agent = createMockAgent({
        modelConfig: {
          provider: "anthropic",
          model: "claude-3-opus",
          maxTokens: 4096,
          temperature: 0.7,
        },
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState())
      );

      await service.generateStream("tenant-1", {
        agentId: "agent-1",
        message: "hi",
      });

      const call = mockLlmExecutor.streamTextRaw.mock.calls[0];
      const params = call[0] as Record<string, unknown>;
      expect(params.provider).toBe("anthropic");
      expect(params.model).toBe("claude-3-opus");
      expect(params.maxTokens).toBe(4096);
      expect(params.temperature).toBe(0.7);
    });

    it("should default to openai/gpt-4o when modelConfig is missing", async () => {
      const agent = createMockAgent({ modelConfig: {} });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState())
      );

      await service.generateStream("tenant-1", {
        agentId: "agent-1",
        message: "hi",
      });

      const call = mockLlmExecutor.streamTextRaw.mock.calls[0];
      const params = call[0] as Record<string, unknown>;
      expect(params.provider).toBe("openai");
      expect(params.model).toBe("gpt-4o");
    });

    it("should include userMessage in the messages array sent to llmExecutor", async () => {
      const agent = createMockAgent();
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      const state = createMockState({
        conversationHistory: [
          {
            role: "user" as const,
            content: "previous message",
            timestamp: new Date().toISOString(),
          },
          {
            role: "assistant" as const,
            content: "previous reply",
            timestamp: new Date().toISOString(),
          },
        ],
        userMessage: "new message",
      });
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(state)
      );

      await service.generateStream("tenant-1", {
        agentId: "agent-1",
        message: "new message",
      });

      const call = mockLlmExecutor.streamTextRaw.mock.calls[0];
      const params = call[0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const lastMessage = params.messages[params.messages.length - 1];
      expect(lastMessage.role).toBe("user");
      expect(lastMessage.content).toBe("new message");
      // Should also include conversation history
      expect(params.messages.length).toBe(4); // 1 system + 2 history + 1 user
    });

    it("should return agentId in the result", async () => {
      const agent = createMockAgent({ id: "agent-42" });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState())
      );

      const result = await service.generateStream("tenant-1", {
        agentId: "agent-42",
        message: "hi",
      });

      expect(result.agentId).toBe("agent-42");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // preparePrompt — tested through public methods
  // ────────────────────────────────────────────────────────────────────────

  describe("preparePrompt (via generateReply)", () => {
    // ──────────────────────────────────────────────────────────────────────
    // Template rendering
    // ──────────────────────────────────────────────────────────────────────

    it("should call renderPromptText with agent.systemPrompt and runtimeContext", async () => {
      const agent = createMockAgent({
        systemPrompt: "Hello {{agent.name}}, welcome!",
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      const state = createMockState({
        systemPrompt: "Hello {{agent.name}}, welcome!",
        runtimeContext: {
          tenantId: "t-1",
          agentId: "agent-1",
          agent: { name: "Bot" },
          input: { message: "test" },
        },
      });
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(state)
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        () => "Hello Bot, welcome!"
      );

      await service.generateReply("tenant-1", baseRequest);

      expect(mockTemplateRenderer.renderPromptText).toHaveBeenCalledTimes(1);
      const call = mockTemplateRenderer.renderPromptText.mock.calls[0];
      expect(call[0]).toBe("Hello {{agent.name}}, welcome!");
      // Second argument is runtimeContext
      expect(call[1]).toEqual(state.runtimeContext);
    });

    it("should set renderedSystemPrompt to the rendered template output", async () => {
      const agent = createMockAgent({
        systemPrompt: "Hello {{agent.name}}",
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(
          createMockState({ systemPrompt: "Hello {{agent.name}}" })
        )
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        () => "Hello TestAgent Rendered"
      );

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      expect(passedState.renderedSystemPrompt).toBe("Hello TestAgent Rendered");
    });

    it("should pass a warnings array as third argument to renderPromptText", async () => {
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState())
      );

      await service.generateReply("tenant-1", baseRequest);

      const call = mockTemplateRenderer.renderPromptText.mock.calls[0];
      expect(Array.isArray(call[2])).toBe(true);
    });

    // ──────────────────────────────────────────────────────────────────────
    // @skill: reference triggers skill resolution
    // ──────────────────────────────────────────────────────────────────────

    it("should call skillRouter.setSkills when agent has skills and parse @skill: references", async () => {
      const agent = createMockAgent({
        systemPrompt: "Use @skill:deploy to deploy the app",
        skills: [deploySkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(
          createMockState({
            systemPrompt: "Use @skill:deploy to deploy the app",
          })
        )
      );
      // renderPromptText passes through so @skill: survives for parsePromptReferences
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );

      await service.generateReply("tenant-1", baseRequest);

      expect(mockSkillRouter.setSkills).toHaveBeenCalledTimes(1);
      expect(mockSkillRouter.setSkills).toHaveBeenCalledWith([deploySkill]);
    });

    it("should call skillRouter.findSkill with explicitSkillName from @skill: reference", async () => {
      const agent = createMockAgent({
        systemPrompt: "Please use @skill:deploy now",
        skills: [deploySkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(
          createMockState({
            systemPrompt: "Please use @skill:deploy now",
            userMessage: "deploy to prod",
          })
        )
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );

      await service.generateReply("tenant-1", baseRequest);

      expect(mockSkillRouter.findSkill).toHaveBeenCalledTimes(1);
      const call = mockSkillRouter.findSkill.mock.calls[0];
      const skillContext = call[0] as {
        userMessage: string;
        explicitSkillName: string;
        availableSkills: SkillDefinition[];
      };
      expect(skillContext.explicitSkillName).toBe("deploy");
      expect(skillContext.userMessage).toBe("deploy to prod");
      expect(skillContext.availableSkills).toEqual([deploySkill]);
    });

    it("should strip @skill: references from renderedSystemPrompt", async () => {
      const agent = createMockAgent({
        systemPrompt: "Use @skill:deploy to deploy",
        skills: [deploySkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(
          createMockState({ systemPrompt: "Use @skill:deploy to deploy" })
        )
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      // Router returns null → no skill resolved
      mockSkillRouter.findSkill.mockImplementationOnce(() => null);

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      // @skill:deploy should be stripped (parsePromptReferences removes it)
      expect(passedState.renderedSystemPrompt).not.toContain("@skill:");
      // The cleaned text should still contain "Use" and "to deploy"
      expect(passedState.renderedSystemPrompt).toContain("Use");
      expect(passedState.renderedSystemPrompt).toContain("to deploy");
    });

    // ──────────────────────────────────────────────────────────────────────
    // Skill resolved → instructions injected
    // ──────────────────────────────────────────────────────────────────────

    it("should execute skill inline and inject instructions when skill is resolved", async () => {
      const agent = createMockAgent({
        systemPrompt: "Use @skill:deploy for deployments",
        skills: [deploySkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(
          createMockState({
            systemPrompt: "Use @skill:deploy for deployments",
            userMessage: "deploy to production",
          })
        )
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => deploySkill);
      mockSkillExecutor.executeInline.mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          skillName: "deploy",
          skillId: "skill-1",
          executionMode: "inline",
          processedInstructions: "Deploy instructions: step 1, step 2",
          output: undefined,
          warnings: [],
        } satisfies SkillResult)
      );

      await service.generateReply("tenant-1", baseRequest);

      // Verify executeInline called
      expect(mockSkillExecutor.executeInline).toHaveBeenCalledTimes(1);
      const execCall = mockSkillExecutor.executeInline.mock.calls[0];
      const params = execCall[0] as SkillExecutionParams;
      expect(params.skill).toBe(deploySkill);
      expect(params.userMessage).toBe("deploy to production");
    });

    it("should set activeSkillName and skillInstructions when skill resolved", async () => {
      const agent = createMockAgent({
        systemPrompt: "Use @skill:deploy",
        skills: [deploySkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState({ systemPrompt: "Use @skill:deploy" }))
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => deploySkill);
      mockSkillExecutor.executeInline.mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          skillName: "deploy",
          skillId: "skill-1",
          executionMode: "inline",
          processedInstructions: "Deploy step-by-step guide",
          output: undefined,
          warnings: [],
        } satisfies SkillResult)
      );

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      expect(passedState.activeSkillName).toBe("deploy");
      expect(passedState.skillInstructions).toBe("Deploy step-by-step guide");
    });

    it("should include '## Active Skill' header in renderedSystemPrompt when skill resolved", async () => {
      const agent = createMockAgent({
        systemPrompt: "Use @skill:deploy now",
        skills: [deploySkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(
          createMockState({ systemPrompt: "Use @skill:deploy now" })
        )
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => deploySkill);
      mockSkillExecutor.executeInline.mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          skillName: "deploy",
          skillId: "skill-1",
          executionMode: "inline",
          processedInstructions: "Deploy the application",
          output: undefined,
          warnings: [],
        } satisfies SkillResult)
      );

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      expect(passedState.renderedSystemPrompt).toContain(
        "## Active Skill: deploy"
      );
      expect(passedState.renderedSystemPrompt).toContain(
        "Deploy the application"
      );
    });

    it("should not inject skill instructions when executeInline returns no processedInstructions", async () => {
      const agent = createMockAgent({
        systemPrompt: "Use @skill:deploy",
        skills: [deploySkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState({ systemPrompt: "Use @skill:deploy" }))
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => deploySkill);
      mockSkillExecutor.executeInline.mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          skillName: "deploy",
          skillId: "skill-1",
          executionMode: "inline",
          processedInstructions: undefined,
          output: undefined,
          warnings: [],
        } satisfies SkillResult)
      );

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      // Should NOT contain Active Skill header when processedInstructions is undefined
      expect(passedState.renderedSystemPrompt).not.toContain("## Active Skill");
      expect(passedState.skillInstructions).toBeUndefined();
    });

    // ──────────────────────────────────────────────────────────────────────
    // Skills available but none resolved → summaries appended
    // ──────────────────────────────────────────────────────────────────────

    it("should append skill summaries when skills exist but none resolved", async () => {
      const agent = createMockAgent({
        systemPrompt: "You are a helpful assistant",
        skills: [deploySkill, pricingSkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(
          createMockState({ systemPrompt: "You are a helpful assistant" })
        )
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => null);
      mockSkillRouter.getSkillSummariesForLlm.mockImplementationOnce(
        () => "- deploy: Deploy apps\n- pricing: Pricing info"
      );

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      expect(passedState.renderedSystemPrompt).toContain("## Available Skills");
      expect(passedState.renderedSystemPrompt).toContain(
        "- deploy: Deploy apps"
      );
      expect(passedState.renderedSystemPrompt).toContain(
        "- pricing: Pricing info"
      );
    });

    it("should set activeSkillName to undefined when no skill resolved", async () => {
      const agent = createMockAgent({
        systemPrompt: "You are helpful",
        skills: [deploySkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState({ systemPrompt: "You are helpful" }))
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => null);

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      expect(passedState.activeSkillName).toBeUndefined();
    });

    // ──────────────────────────────────────────────────────────────────────
    // Skills available but "No skills available." → no summaries
    // ──────────────────────────────────────────────────────────────────────

    it("should NOT append summaries when getSkillSummariesForLlm returns 'No skills available.'", async () => {
      const agent = createMockAgent({
        systemPrompt: "You are a bot",
        skills: [disabledSkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState({ systemPrompt: "You are a bot" }))
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => null);
      mockSkillRouter.getSkillSummariesForLlm.mockImplementationOnce(
        () => "No skills available."
      );

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      expect(passedState.renderedSystemPrompt).not.toContain(
        "## Available Skills"
      );
    });

    it("should NOT append summaries when getSkillSummariesForLlm returns empty string", async () => {
      const agent = createMockAgent({
        systemPrompt: "You are a bot",
        skills: [deploySkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState({ systemPrompt: "You are a bot" }))
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => null);
      mockSkillRouter.getSkillSummariesForLlm.mockImplementationOnce(() => "");

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      expect(passedState.renderedSystemPrompt).not.toContain(
        "## Available Skills"
      );
    });

    // ──────────────────────────────────────────────────────────────────────
    // Edge: agent with skills array but all disabled
    // ──────────────────────────────────────────────────────────────────────

    it("should still call skillRouter.setSkills with disabled skills but find none", async () => {
      const agent = createMockAgent({
        systemPrompt: "You help users",
        skills: [disabledSkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState({ systemPrompt: "You help users" }))
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => null);
      // Router returns "No skills available." because all disabled
      mockSkillRouter.getSkillSummariesForLlm.mockImplementationOnce(
        () => "No skills available."
      );

      await service.generateReply("tenant-1", baseRequest);

      expect(mockSkillRouter.setSkills).toHaveBeenCalledWith([disabledSkill]);
      expect(mockSkillRouter.findSkill).toHaveBeenCalled();
      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      // No summaries appended because router said "No skills available."
      expect(passedState.renderedSystemPrompt).not.toContain(
        "## Available Skills"
      );
    });

    // ──────────────────────────────────────────────────────────────────────
    // @tool: references are parsed but do not trigger skill resolution
    // ──────────────────────────────────────────────────────────────────────

    it("should strip @tool: references from prompt without affecting skill resolution", async () => {
      const agent = createMockAgent({
        systemPrompt: "Use @tool:calculator and @skill:deploy for this",
        skills: [deploySkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(
          createMockState({
            systemPrompt: "Use @tool:calculator and @skill:deploy for this",
          })
        )
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => deploySkill);
      mockSkillExecutor.executeInline.mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          skillName: "deploy",
          skillId: "skill-1",
          executionMode: "inline",
          processedInstructions: "Deploy instructions",
          output: undefined,
          warnings: [],
        } satisfies SkillResult)
      );

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      // @tool: and @skill: should be stripped
      expect(passedState.renderedSystemPrompt).not.toContain("@tool:");
      expect(passedState.renderedSystemPrompt).not.toContain("@skill:");
      // The text should still contain the non-reference parts
      expect(passedState.renderedSystemPrompt).toContain("Use");
      expect(passedState.renderedSystemPrompt).toContain("and");
      expect(passedState.renderedSystemPrompt).toContain("for this");
    });

    // ──────────────────────────────────────────────────────────────────────
    // Multiple @skill: references — only first is used
    // ──────────────────────────────────────────────────────────────────────

    it("should pass only the first @skill: reference as explicitSkillName", async () => {
      const agent = createMockAgent({
        systemPrompt: "Use @skill:deploy then @skill:pricing",
        skills: [deploySkill, pricingSkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(
          createMockState({
            systemPrompt: "Use @skill:deploy then @skill:pricing",
          })
        )
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => deploySkill);
      mockSkillExecutor.executeInline.mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          skillName: "deploy",
          skillId: "skill-1",
          executionMode: "inline",
          processedInstructions: "Deploy instructions",
          output: undefined,
          warnings: [],
        } satisfies SkillResult)
      );

      await service.generateReply("tenant-1", baseRequest);

      const findCall = mockSkillRouter.findSkill.mock.calls[0];
      const skillContext = findCall[0] as {
        explicitSkillName: string;
      };
      expect(skillContext.explicitSkillName).toBe("deploy");
    });

    // ──────────────────────────────────────────────────────────────────────
    // State spread — original state fields preserved
    // ──────────────────────────────────────────────────────────────────────

    it("should preserve all original state fields in returned state", async () => {
      const originalState = createMockState({
        systemPrompt: "Hello",
        memoryContext: "User likes Python",
        conversationHistory: [
          {
            role: "user" as const,
            content: "I like Python",
            timestamp: new Date().toISOString(),
          },
        ],
        userMessage: "Help me with Python",
      });
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(originalState)
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        () => "Hello rendered"
      );

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      // Original fields preserved
      expect(passedState.memoryContext).toBe("User likes Python");
      expect(passedState.conversationHistory).toHaveLength(1);
      expect(passedState.userMessage).toBe("Help me with Python");
      // New fields added
      expect(passedState.renderedSystemPrompt).toBe("Hello rendered");
    });

    // ──────────────────────────────────────────────────────────────────────
    // executeInline receives correct parameters from agent config
    // ──────────────────────────────────────────────────────────────────────

    it("should pass agent modelConfig provider/model to executeInline", async () => {
      const agent = createMockAgent({
        systemPrompt: "Use @skill:deploy",
        skills: [deploySkill],
        modelConfig: { provider: "anthropic", model: "claude-3-opus" },
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState({ systemPrompt: "Use @skill:deploy" }))
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => deploySkill);

      await service.generateReply("tenant-1", baseRequest);

      const execCall = mockSkillExecutor.executeInline.mock.calls[0];
      const params = execCall[0] as SkillExecutionParams;
      expect(params.provider).toBe("anthropic");
      expect(params.model).toBe("claude-3-opus");
    });

    it("should default provider/model to openai/gpt-4o when modelConfig is empty in executeInline", async () => {
      const agent = createMockAgent({
        systemPrompt: "Use @skill:deploy",
        skills: [deploySkill],
        modelConfig: {},
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState({ systemPrompt: "Use @skill:deploy" }))
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => deploySkill);

      await service.generateReply("tenant-1", baseRequest);

      const execCall = mockSkillExecutor.executeInline.mock.calls[0];
      const params = execCall[0] as SkillExecutionParams;
      expect(params.provider).toBe("openai");
      expect(params.model).toBe("gpt-4o");
    });

    it("should pass tenantId from runtimeContext to executeInline", async () => {
      const agent = createMockAgent({
        systemPrompt: "Use @skill:deploy",
        skills: [deploySkill],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      const state = createMockState({
        systemPrompt: "Use @skill:deploy",
        runtimeContext: {
          tenantId: "tenant-42",
          agentId: "agent-1",
          input: { message: "test" },
          agent: { id: "agent-1", name: "TestAgent" },
        },
      });
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(state)
      );
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (t: string) => t
      );
      mockSkillRouter.findSkill.mockImplementationOnce(() => deploySkill);

      await service.generateReply("tenant-1", baseRequest);

      const execCall = mockSkillExecutor.executeInline.mock.calls[0];
      const params = execCall[0] as SkillExecutionParams;
      expect(params.tenantId).toBe("tenant-42");
      expect(params.agentId).toBe("agent-1");
    });

    // ──────────────────────────────────────────────────────────────────────
    // Full pipeline: template → @skill: → resolve → execute → inject
    // ──────────────────────────────────────────────────────────────────────

    it("should run the full pipeline: render template → parse refs → resolve skill → inject instructions", async () => {
      const agent = createMockAgent({
        id: "agent-full",
        name: "FullPipelineAgent",
        systemPrompt:
          "You are {{agent.name}}. Use @skill:deploy for deployments.",
        skills: [deploySkill],
        modelConfig: { provider: "openai", model: "gpt-4o" },
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );

      const state = createMockState({
        systemPrompt: agent.systemPrompt,
        userMessage: "Deploy to staging",
        runtimeContext: {
          tenantId: "tenant-full",
          agentId: "agent-full",
          input: { message: "Deploy to staging" },
          agent: { id: "agent-full", name: "FullPipelineAgent" },
        },
      });
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(state)
      );

      // Step 1: Template rendering replaces {{agent.name}}
      mockTemplateRenderer.renderPromptText.mockImplementationOnce(
        (template: string) =>
          template.replace("{{agent.name}}", "FullPipelineAgent")
      );

      // Step 3: Skill resolution
      mockSkillRouter.findSkill.mockImplementationOnce(() => deploySkill);

      // Step 4: Skill execution
      mockSkillExecutor.executeInline.mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          skillName: "deploy",
          skillId: "skill-1",
          executionMode: "inline",
          processedInstructions: "Follow these deployment steps carefully.",
          output: undefined,
          warnings: [],
        } satisfies SkillResult)
      );

      const request: ChatRequest = {
        agentId: "agent-full",
        message: "Deploy to staging",
        sessionId: "session-full",
      };

      const result = await service.generateReply("tenant-full", request);

      // Verify delegation to sessionChat
      expect(mockSessionChat.generateReply).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockChatResponse);

      // Verify the final state
      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const finalState = callArgs[3] as RuntimeState;

      // Template was rendered
      expect(mockTemplateRenderer.renderPromptText).toHaveBeenCalledWith(
        agent.systemPrompt,
        state.runtimeContext,
        expect.any(Array)
      );

      // Skills were set
      expect(mockSkillRouter.setSkills).toHaveBeenCalledWith([deploySkill]);

      // Skill was resolved
      expect(mockSkillRouter.findSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: "Deploy to staging",
          explicitSkillName: "deploy",
        })
      );

      // Skill was executed
      expect(mockSkillExecutor.executeInline).toHaveBeenCalledWith(
        expect.objectContaining({
          skill: deploySkill,
          userMessage: "Deploy to staging",
          tenantId: "tenant-full",
          agentId: "agent-full",
        })
      );

      // Final state has everything
      expect(finalState.renderedSystemPrompt).toContain(
        "You are FullPipelineAgent"
      );
      expect(finalState.renderedSystemPrompt).not.toContain("@skill:");
      expect(finalState.renderedSystemPrompt).toContain(
        "## Active Skill: deploy"
      );
      expect(finalState.renderedSystemPrompt).toContain(
        "Follow these deployment steps carefully."
      );
      expect(finalState.activeSkillName).toBe("deploy");
      expect(finalState.skillInstructions).toBe(
        "Follow these deployment steps carefully."
      );
    });

    // ──────────────────────────────────────────────────────────────────────
    // Tool resolution — tools resolved when agent has tools
    // ──────────────────────────────────────────────────────────────────────

    it("should call toolBridge.toAiSdkToolsForAgent when agent has tools", async () => {
      const agent = createMockAgent({
        systemPrompt: "You are a helpful assistant.",
        tools: [{ name: "calculator" }],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(
          createMockState({ systemPrompt: "You are a helpful assistant." })
        )
      );

      await service.generateReply("tenant-1", baseRequest);

      expect(mockToolBridge.toAiSdkToolsForAgent).toHaveBeenCalledTimes(1);
      const callArgs = mockToolBridge.toAiSdkToolsForAgent.mock.calls[0];
      // First arg is agent.tools array
      expect(callArgs[0]).toEqual([{ name: "calculator" }]);
      // Second arg is toolState with tenantId and agentId
      const toolState = callArgs[1] as { tenantId: string; agentId: string };
      expect(toolState.tenantId).toBe("tenant-1");
      expect(toolState.agentId).toBe("agent-1");
    });

    it("should set resolvedTools on the returned state when agent has tools", async () => {
      const agent = createMockAgent({
        systemPrompt: "You are a helper.",
        tools: [{ name: "search" }],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState({ systemPrompt: "You are a helper." }))
      );

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      expect(passedState.resolvedTools).toBeDefined();
      expect(Object.keys(passedState.resolvedTools!).length).toBeGreaterThan(0);
    });

    it("should call toolBridge.toAiSdkToolsForAgent when agent has no explicit tools but MCP is unrestricted (enabledMcpServers null)", async () => {
      const agent = createMockAgent({
        systemPrompt: "You are a helpful assistant.",
        tools: [],
        enabledMcpServers: null,
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(
          createMockState({ systemPrompt: "You are a helpful assistant." })
        )
      );

      await service.generateReply("tenant-1", baseRequest);

      expect(mockToolBridge.toAiSdkToolsForAgent).toHaveBeenCalled();
    });

    it("should NOT call toolBridge.toAiSdkToolsForAgent when agent has no tools and MCP is explicitly disabled", async () => {
      const agent = createMockAgent({
        systemPrompt: "You are a helpful assistant.",
        tools: [],
        enabledMcpServers: [],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(
          createMockState({ systemPrompt: "You are a helpful assistant." })
        )
      );

      await service.generateReply("tenant-1", baseRequest);

      expect(mockToolBridge.toAiSdkToolsForAgent).not.toHaveBeenCalled();
    });

    it("should set resolvedTools to undefined when agent has no tools and MCP is explicitly disabled", async () => {
      const agent = createMockAgent({
        systemPrompt: "You are helpful.",
        tools: [],
        enabledMcpServers: [],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState({ systemPrompt: "You are helpful." }))
      );

      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      expect(passedState.resolvedTools).toBeUndefined();
    });

    it("should fall back to no tools when toolBridge.toAiSdkToolsForAgent throws", async () => {
      const agent = createMockAgent({
        systemPrompt: "You are a helper.",
        tools: [{ name: "broken-tool" }],
      });
      mockAgentManager.getAgent.mockImplementationOnce(() =>
        Promise.resolve(agent)
      );
      mockContextBuilder.buildRuntimeState.mockImplementationOnce(() =>
        Promise.resolve(createMockState({ systemPrompt: "You are a helper." }))
      );
      mockToolBridge.toAiSdkToolsForAgent.mockImplementationOnce(() => {
        throw new Error("Tool resolution failed");
      });

      // Should not throw — gracefully falls back
      await service.generateReply("tenant-1", baseRequest);

      const callArgs = mockSessionChat.generateReply.mock.calls[0];
      const passedState = callArgs[3] as RuntimeState;
      expect(passedState.resolvedTools).toBeUndefined();
    });
  });
});
