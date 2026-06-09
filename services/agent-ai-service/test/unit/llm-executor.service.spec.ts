import "reflect-metadata";
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";

// ---------------------------------------------------------------------------
// Mock @nestjs/common to provide a Logger with ALL methods (including debug).
// tool-registry.service.spec.ts mocks @nestjs/common with a Logger that lacks
// `debug`, causing LlmExecutorService.logger.debug to be undefined when that
// test file runs first in the full suite.
// ---------------------------------------------------------------------------
mock.module("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Inject: () => (target: any, key: string) => target,
  Logger: class MockLogger {
    log = mock(() => {});
    warn = mock(() => {});
    error = mock(() => {});
    debug = mock(() => {});
    verbose = mock(() => {});
    fatal = mock(() => {});
    static overrideLogger = mock(() => {});
  },
}));

// ---------------------------------------------------------------------------
// Mock AI SDK functions — no real API calls.
// ---------------------------------------------------------------------------
const mockGenerateText = mock(() =>
  Promise.resolve({
    text: "Hello there",
    usage: { inputTokens: 100, outputTokens: 50 },
    toolCalls: [],
    steps: [{ toolCalls: [] }],
  }),
);

const mockStreamText = mock(() => ({
  textStream: (async function* () {
    yield "Hello ";
    yield "world";
  })(),
  usage: Promise.resolve({ inputTokens: 80, outputTokens: 40 }),
}));

const mockGenerateObject = mock(() =>
  Promise.resolve({
    object: { name: "test-object", value: 42 },
    usage: { inputTokens: 60, outputTokens: 30 },
  }),
);

const mockStreamObject = mock(() => ({
  partialObjectStream: (async function* () {
    yield { name: "te" };
    yield { name: "test", value: 4 };
    yield { name: "test-object", value: 42 };
  })(),
  object: Promise.resolve({ name: "test-object", value: 42 }),
  usage: Promise.resolve({ inputTokens: 70, outputTokens: 35 }),
}));

mock.module("ai", () => ({
  generateText: mockGenerateText,
  streamText: mockStreamText,
  generateObject: mockGenerateObject,
  streamObject: mockStreamObject,
}));

// ---------------------------------------------------------------------------
// Import real CostTrackerService and mock its static method directly.
// We CANNOT use mock.module here because it replaces the class entirely,
// which breaks NestJS DI resolution (the injection token changes).
// ---------------------------------------------------------------------------
import { CostTrackerService } from "../../src/modules/llm/cost-tracker.service";

// Save original to restore after tests
const originalEstimateCost = CostTrackerService.estimateCost;
// Override the static method
(CostTrackerService as any).estimateCost = mock(() => 0.001);

import { Test } from "@nestjs/testing";
import {
  LlmExecutorService,
  type GenerateTextWithToolsParams,
  type GenerateStructuredOutputParams,
} from "../../src/modules/llm/llm-executor.service";
import { ProviderRegistryService } from "../../src/modules/llm/provider-registry.service";
import { CredentialResolverService } from "../../src/modules/llm/credential-resolver.service";
import type { z } from "zod";

// Restore after all tests
afterAll(() => {
  (CostTrackerService as any).estimateCost = originalEstimateCost;
});

// ── Fixtures ──────────────────────────────────────────────────────────────

const fakeModel = {
  specificationVersion: "v1" as const,
  provider: "openai" as const,
  modelId: "gpt-4o",
  defaultObjectGenerationMode: "json" as const,
  supportsUrl: () => false,
  doGenerate: mock(() => Promise.resolve({})),
  doStream: mock(() => Promise.resolve({})),
};

const baseParams: GenerateTextWithToolsParams = {
  tenantId: "t-1",
  agentId: "a-1",
  executionId: "e-1",
  provider: "openai",
  model: "gpt-4o",
  prompt: "Hello",
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("LlmExecutorService — new AI SDK v4 methods", () => {
  let executor: LlmExecutorService;
  let mockProviderRegistry: { createModel: ReturnType<typeof mock> };
  let mockCredentialResolver: { resolve: ReturnType<typeof mock> };
  let mockRecordCost: ReturnType<typeof mock>;

  beforeEach(async () => {
    mockProviderRegistry = {
      createModel: mock(() => fakeModel),
    };
    mockCredentialResolver = {
      resolve: mock(() =>
        Promise.resolve({
          provider: "openai",
          model: "gpt-4o",
          apiKey: "sk-test",
        }),
      ),
    };

    mockRecordCost = mock(() => Promise.resolve(true));

    // Reset static mock to default
    (CostTrackerService.estimateCost as any).mockImplementation(() => 0.001);

    // Reset AI SDK mocks to defaults
    mockGenerateText.mockClear();
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: "Hello there",
        usage: { inputTokens: 100, outputTokens: 50 },
        toolCalls: [],
        steps: [{ toolCalls: [] }],
      }),
    );

    mockGenerateObject.mockClear();
    mockGenerateObject.mockImplementation(() =>
      Promise.resolve({
        object: { name: "test-object", value: 42 },
        usage: { inputTokens: 60, outputTokens: 30 },
      }),
    );

    mockStreamObject.mockClear();
    mockStreamObject.mockImplementation(() => ({
      partialObjectStream: (async function* () {
        yield { name: "te" };
        yield { name: "test", value: 4 };
        yield { name: "test-object", value: 42 };
      })(),
      object: Promise.resolve({ name: "test-object", value: 42 }),
      usage: Promise.resolve({ inputTokens: 70, outputTokens: 35 }),
    }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmExecutorService,
        {
          provide: ProviderRegistryService,
          useValue: mockProviderRegistry,
        },
        {
          provide: CredentialResolverService,
          useValue: mockCredentialResolver,
        },
        {
          provide: CostTrackerService,
          useValue: { recordCost: mockRecordCost },
        },
      ],
    }).compile();

    executor = moduleRef.get(LlmExecutorService);
  });

  // ────────────────────────────────────────────────────────────────────────
  // generateTextWithTools
  // ────────────────────────────────────────────────────────────────────────

  describe("generateTextWithTools", () => {
    it("should not pass maxSteps to generateText (removed in AI SDK v6)", async () => {
      await executor.generateTextWithTools({ ...baseParams, maxSteps: 3 });

      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      const callArg = mockGenerateText.mock.calls[0][0] as any;
      expect(callArg.maxSteps).toBeUndefined();
    });

    it("should call generateText without maxSteps when not specified", async () => {
      await executor.generateTextWithTools(baseParams);

      const callArg = mockGenerateText.mock.calls[0][0] as any;
      expect(callArg.maxSteps).toBeUndefined();
    });

    it("should return text from generateText result", async () => {
      const result = await executor.generateTextWithTools(baseParams);

      expect(result.text).toBe("Hello there");
    });

    it("should aggregate tool calls from all steps", async () => {
      mockGenerateText.mockImplementationOnce(() =>
        Promise.resolve({
          text: "Done",
          usage: { inputTokens: 200, outputTokens: 100 },
          toolCalls: [],
          steps: [
            {
              toolCalls: [
                {
                  type: "tool-call",
                  toolName: "search",
                  args: { query: "test" },
                },
              ],
            },
            {
              toolCalls: [
                {
                  type: "tool-call",
                  toolName: "calculator",
                  args: { expression: "2+2" },
                },
                {
                  type: "tool-call",
                  toolName: "search",
                  args: { query: "other" },
                },
              ],
            },
          ],
        }),
      );

      const result = await executor.generateTextWithTools({
        ...baseParams,
        maxSteps: 3,
      });

      expect(result.toolCalls).toHaveLength(3);
      expect(result.toolCalls[0]).toEqual({
        type: "tool-call",
        toolName: "search",
        args: { query: "test" },
      });
      expect(result.toolCalls[1]).toEqual({
        type: "tool-call",
        toolName: "calculator",
        args: { expression: "2+2" },
      });
      expect(result.toolCalls[2]).toEqual({
        type: "tool-call",
        toolName: "search",
        args: { query: "other" },
      });
    });

    it("should return empty tool calls when steps have none", async () => {
      const result = await executor.generateTextWithTools(baseParams);

      expect(result.toolCalls).toEqual([]);
    });

    it("should record cost via costTracker.recordCost", async () => {
      await executor.generateTextWithTools(baseParams);

      expect(mockRecordCost).toHaveBeenCalledTimes(1);
      const event = mockRecordCost.mock.calls[0][0] as any;
      expect(event.tenantId).toBe("t-1");
      expect(event.agentId).toBe("a-1");
      expect(event.executionId).toBe("e-1");
      expect(event.provider).toBe("openai");
      expect(event.model).toBe("gpt-4o");
      expect(event.inputTokens).toBe(100);
      expect(event.outputTokens).toBe(50);
      expect(event.costUsd).toBe(0.001);
    });

    it("should compute usage correctly from generateText result", async () => {
      const result = await executor.generateTextWithTools(baseParams);

      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
      expect(result.usage.totalTokens).toBe(150);
    });

    it("should pass onStepFinish callback to generateText", async () => {
      const onStepFinish = mock(() => Promise.resolve(undefined));

      await executor.generateTextWithTools({
        ...baseParams,
        onStepFinish,
      });

      const callArg = mockGenerateText.mock.calls[0][0] as any;
      expect(callArg.onStepFinish).toBe(onStepFinish);
    });

    it("should pass tools to generateText", async () => {
      const tools = {
        calculator: {
          description: "Calculate",
          parameters: {},
          execute: mock(() => Promise.resolve("42")),
        },
      };

      await executor.generateTextWithTools({ ...baseParams, tools });

      const callArg = mockGenerateText.mock.calls[0][0] as any;
      expect(callArg.tools).toBe(tools);
    });

    it("should resolve credentials before calling generateText", async () => {
      await executor.generateTextWithTools(baseParams);

      expect(mockCredentialResolver.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "t-1",
          agentId: "a-1",
          provider: "openai",
          model: "gpt-4o",
        }),
      );
      expect(mockProviderRegistry.createModel).toHaveBeenCalledWith(
        "openai",
        "gpt-4o",
        "sk-test",
        undefined,
      );
    });

    it("should include provider and model in result", async () => {
      const result = await executor.generateTextWithTools(baseParams);

      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o");
    });

    it("should include costUsd in result", async () => {
      const result = await executor.generateTextWithTools(baseParams);

      expect(result.costUsd).toBe(0.001);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // generateStructuredOutput
  // ────────────────────────────────────────────────────────────────────────

  describe("generateStructuredOutput", () => {
    const structuredParams: GenerateStructuredOutputParams = {
      tenantId: "t-1",
      agentId: "a-1",
      executionId: "e-1",
      provider: "openai",
      model: "gpt-4o",
      schema: {} as z.ZodType<any>,
      prompt: "Extract data",
    };

    it("should call generateObject with schema", async () => {
      await executor.generateStructuredOutput(structuredParams);

      expect(mockGenerateObject).toHaveBeenCalledTimes(1);
      const callArg = mockGenerateObject.mock.calls[0][0] as any;
      expect(callArg.schema).toBe(structuredParams.schema);
    });

    it("should return typed object from generateObject", async () => {
      const result =
        await executor.generateStructuredOutput<{ name: string; value: number }>(
          structuredParams,
        );

      expect(result.object).toEqual({ name: "test-object", value: 42 });
    });

    it("should record cost via costTracker.recordCost", async () => {
      await executor.generateStructuredOutput(structuredParams);

      expect(mockRecordCost).toHaveBeenCalledTimes(1);
      const event = mockRecordCost.mock.calls[0][0] as any;
      expect(event.inputTokens).toBe(60);
      expect(event.outputTokens).toBe(30);
      expect(event.costUsd).toBe(0.001);
    });

    it("should compute usage correctly", async () => {
      const result = await executor.generateStructuredOutput(structuredParams);

      expect(result.usage.inputTokens).toBe(60);
      expect(result.usage.outputTokens).toBe(30);
      expect(result.usage.totalTokens).toBe(90);
    });

    it("should pass prompt to generateObject", async () => {
      await executor.generateStructuredOutput(structuredParams);

      const callArg = mockGenerateObject.mock.calls[0][0] as any;
      expect(callArg.prompt).toBe("Extract data");
    });

    it("should pass system prompt when provided", async () => {
      await executor.generateStructuredOutput({
        ...structuredParams,
        systemPrompt: "You extract data",
      });

      const callArg = mockGenerateObject.mock.calls[0][0] as any;
      expect(callArg.system).toBe("You extract data");
    });

    it("should not pass mode to generateObject (removed in AI SDK v6)", async () => {
      await executor.generateStructuredOutput({
        ...structuredParams,
        mode: "tool",
      });

      const callArg = mockGenerateObject.mock.calls[0][0] as any;
      expect(callArg.mode).toBeUndefined();
    });

    it("should include provider and model in result", async () => {
      const result = await executor.generateStructuredOutput(structuredParams);

      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o");
    });

    it("should include costUsd in result", async () => {
      const result = await executor.generateStructuredOutput(structuredParams);

      expect(result.costUsd).toBe(0.001);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // streamStructuredOutput
  // ────────────────────────────────────────────────────────────────────────

  describe("streamStructuredOutput", () => {
    const streamParams: GenerateStructuredOutputParams = {
      tenantId: "t-1",
      agentId: "a-1",
      executionId: "e-1",
      provider: "openai",
      model: "gpt-4o",
      schema: {} as z.ZodType<any>,
      prompt: "Stream data",
    };

    it("should return partialObjectStream from streamObject", async () => {
      const result = await executor.streamStructuredOutput(streamParams);

      expect(result.partialObjectStream).toBeDefined();

      const chunks: any[] = [];
      for await (const chunk of result.partialObjectStream) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ name: "te" });
      expect(chunks[2]).toEqual({ name: "test-object", value: 42 });
    });

    it("should return object promise that resolves to final object", async () => {
      const result = await executor.streamStructuredOutput(streamParams);

      const obj = await result.object;
      expect(obj).toEqual({ name: "test-object", value: 42 });
    });

    it("should track cost via usage promise", async () => {
      const result = await executor.streamStructuredOutput(streamParams);

      const usage = await result.usage;

      expect(usage.inputTokens).toBe(70);
      expect(usage.outputTokens).toBe(35);
      expect(usage.totalTokens).toBe(105);
    });

    it("should record cost after usage resolves", async () => {
      const result = await executor.streamStructuredOutput(streamParams);

      // Usage promise triggers cost recording
      await result.usage;

      expect(mockRecordCost).toHaveBeenCalledTimes(1);
      const event = mockRecordCost.mock.calls[0][0] as any;
      expect(event.inputTokens).toBe(70);
      expect(event.outputTokens).toBe(35);
      expect(event.costUsd).toBe(0.001);
    });

    it("should call streamObject with correct params", async () => {
      await executor.streamStructuredOutput(streamParams);

      expect(mockStreamObject).toHaveBeenCalledTimes(1);
      const callArg = mockStreamObject.mock.calls[0][0] as any;
      expect(callArg.schema).toBe(streamParams.schema);
      expect(callArg.prompt).toBe("Stream data");
    });

    it("should pass system prompt when provided", async () => {
      await executor.streamStructuredOutput({
        ...streamParams,
        systemPrompt: "System instructions",
      });

      const callArg = mockStreamObject.mock.calls[0][0] as any;
      expect(callArg.system).toBe("System instructions");
    });

    it("should pass messages when provided", async () => {
      const messages = [
        { role: "user" as const, content: "Hello" },
      ];

      await executor.streamStructuredOutput({
        ...streamParams,
        messages,
      });

      const callArg = mockStreamObject.mock.calls[0][0] as any;
      expect(callArg.messages).toEqual(messages);
    });

    it("should include provider and model in result", async () => {
      const result = await executor.streamStructuredOutput(streamParams);

      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o");
    });

    it("should pass maxOutputTokens and temperature when provided", async () => {
      await executor.streamStructuredOutput({
        ...streamParams,
        maxTokens: 1000,
        temperature: 0.5,
      });

      const callArg = mockStreamObject.mock.calls[0][0] as any;
      expect(callArg.maxOutputTokens).toBe(1000);
      expect(callArg.temperature).toBe(0.5);
    });
  });
});
