import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type {
  LanguageModel,
  LanguageModelMiddleware,
  ModelMessage,
  Tool,
} from "ai";
import {
  generateObject,
  generateText,
  stepCountIs,
  streamObject,
  streamText,
  wrapLanguageModel,
} from "ai";
import type { z } from "zod";
import type { ICostEvent } from "../../abstractions/cost-event.interface";
import type { KnowledgeBaseSearchService } from "../knowledge-bases/knowledge-base-search.service";
import { CostTrackerService } from "./cost-tracker.service";
// biome-ignore-start lint/style/useImportType: constructor-injected by NestJS DI (no explicit @Inject token) — must be value imports so `design:paramtypes` metadata resolves the real class at runtime, not `type`.
import { CredentialResolverService } from "./credential-resolver.service";
import { ProviderRegistryService } from "./provider-registry.service";
// biome-ignore-end lint/style/useImportType
import { createKnowledgeBaseRagMiddleware } from "./rag-middleware";

export interface GenerateTextParams {
  readonly tenantId: string;
  readonly agentId: string;
  readonly executionId: string;
  readonly provider: string;
  readonly model: string;
  readonly systemPrompt?: string;
  readonly messages?: ModelMessage[];
  readonly prompt?: string;
  readonly tools?: Record<string, Tool>;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly credentialId?: string;
  readonly credentialMode?: string;
  readonly connectorId?: string;
  readonly knowledgeBaseIds?: readonly string[];
}

export interface StreamTextParams extends GenerateTextParams {
  /**
   * Forwarded into the AI SDK `streamText({ abortSignal })` call so a
   * client disconnect / explicit cancel (rt.<tenant>.exec.<id>.cancel)
   * closes the upstream provider socket instead of burning tokens on an
   * orphaned stream. See DOCS/architecture/runtime-streaming.md §2.2.
   */
  readonly abortSignal?: AbortSignal;
}

export interface LlmExecutionResult {
  readonly text: string;
  readonly toolCalls: Array<{
    readonly type: string;
    readonly toolName: string;
    readonly args: Record<string, unknown>;
  }>;
  readonly toolResults?: Array<{
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly result: unknown;
    readonly success?: boolean;
  }>;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly cachedInputTokens?: number;
  };
  readonly provider: string;
  readonly model: string;
  readonly costUsd: number;
}

export interface StreamTextResult {
  readonly textStream: AsyncIterable<string>;
  readonly usage: PromiseLike<{
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  }>;
  readonly provider: string;
  readonly model: string;
}

export interface GenerateTextWithToolsParams extends GenerateTextParams {
  readonly tools?: Record<string, any>; // AI SDK Tool definitions
  readonly maxSteps?: number;
  readonly toolLimits?: Record<string, number>;
  readonly onStepFinish?: any;
}

export interface GenerateStructuredOutputParams {
  readonly tenantId: string;
  readonly agentId: string;
  readonly executionId: string;
  readonly provider: string;
  readonly model: string;
  readonly schema: z.ZodType<any>;
  readonly prompt?: string;
  readonly messages?: ModelMessage[];
  readonly systemPrompt?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly credentialId?: string;
  readonly credentialMode?: string;
  readonly connectorId?: string;
  readonly mode?: "auto" | "json" | "tool";
}

export interface StreamStructuredOutputParams
  extends GenerateStructuredOutputParams {}

@Injectable()
export class LlmExecutorService {
  private readonly logger = new Logger(LlmExecutorService.name);

  constructor(
    private readonly providerRegistry: ProviderRegistryService,
    private readonly credentialResolver: CredentialResolverService,
    private readonly costTracker: CostTrackerService,
    @Inject("KnowledgeBaseSearchService")
    @Optional()
    private readonly knowledgeBaseSearchService: KnowledgeBaseSearchService | null,
  ) {}

  async generateText(params: GenerateTextParams): Promise<LlmExecutionResult> {
    const { model: languageModel, credentials } =
      await this.resolveAndCreateModel(params);

    this.logger.debug(
      `generateText: provider=${params.provider}, model=${params.model}, ` +
        `tenantId=${params.tenantId}, agentId=${params.agentId}`
    );

    const result = await generateText({
      model: languageModel,
      system: params.systemPrompt,
      ...(params.messages
        ? { messages: params.messages }
        : { prompt: params.prompt ?? "" }),
      tools: params.tools,
      maxOutputTokens: params.maxTokens,
      temperature: params.temperature,
    });

    const usage = {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens:
        (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
      cachedInputTokens:
        (result.usage as any)?.inputTokenDetails?.cacheReadTokens ?? 0,
    };

    const costUsd = CostTrackerService.estimateCost(
      params.provider,
      params.model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens ?? 0
    );

    await this.recordCost(params, usage, costUsd);

    const toolCalls = (result.toolCalls ?? []).map((tc) => ({
      type: tc.type as string,
      toolName: tc.toolName,
      args: (tc as any).args as Record<string, unknown>,
    }));

    return {
      text: result.text ?? "",
      toolCalls,
      usage,
      provider: params.provider,
      model: params.model,
      costUsd,
    };
  }

  async streamText(params: StreamTextParams): Promise<LlmExecutionResult> {
    const { model: languageModel } = await this.resolveAndCreateModel(params);

    this.logger.debug(
      `streamText: provider=${params.provider}, model=${params.model}, ` +
        `tenantId=${params.tenantId}, agentId=${params.agentId}`
    );

    const stream = streamText({
      model: languageModel,
      system: params.systemPrompt,
      ...(params.messages
        ? { messages: params.messages }
        : { prompt: params.prompt ?? "" }),
      tools: params.tools,
      maxOutputTokens: params.maxTokens,
      temperature: params.temperature,
    });

    let fullText = "";
    for await (const chunk of stream.textStream) {
      fullText += chunk;
    }

    const usageResult = await stream.usage;
    const usage = {
      inputTokens: usageResult?.inputTokens ?? 0,
      outputTokens: usageResult?.outputTokens ?? 0,
      totalTokens:
        (usageResult?.inputTokens ?? 0) + (usageResult?.outputTokens ?? 0),
      cachedInputTokens:
        (usageResult as any)?.inputTokenDetails?.cacheReadTokens ?? 0,
    };

    const costUsd = CostTrackerService.estimateCost(
      params.provider,
      params.model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens ?? 0
    );

    await this.recordCost(params, usage, costUsd);

    return {
      text: fullText,
      toolCalls: [],
      usage,
      provider: params.provider,
      model: params.model,
      costUsd,
    };
  }

  async streamTextRaw(params: StreamTextParams): Promise<StreamTextResult> {
    const { model: languageModel } = await this.resolveAndCreateModel(params);

    this.logger.debug(
      `streamTextRaw: provider=${params.provider}, model=${params.model}, ` +
        `tenantId=${params.tenantId}, agentId=${params.agentId}`
    );

    const stream = streamText({
      model: languageModel,
      system: params.systemPrompt,
      ...(params.messages
        ? { messages: params.messages }
        : { prompt: params.prompt ?? "" }),
      tools: params.tools,
      maxOutputTokens: params.maxTokens,
      temperature: params.temperature,
      abortSignal: params.abortSignal,
    });

    const costTrackingUsage = stream.usage.then(async (usageResult) => {
      const usage = {
        inputTokens: usageResult?.inputTokens ?? 0,
        outputTokens: usageResult?.outputTokens ?? 0,
        cachedInputTokens:
          (usageResult as any)?.inputTokenDetails?.cacheReadTokens ?? 0,
      };
      const costUsd = CostTrackerService.estimateCost(
        params.provider,
        params.model,
        usage.inputTokens,
        usage.outputTokens,
        usage.cachedInputTokens ?? 0
      );
      await this.recordCost(params, usage, costUsd);
      return { ...usageResult, costUsd };
    });

    return {
      textStream: stream.textStream,
      usage: costTrackingUsage,
      provider: params.provider,
      model: params.model,
    };
  }

  async generateTextWithTools(
    params: GenerateTextWithToolsParams
  ): Promise<LlmExecutionResult> {
    const { model: languageModel } = await this.resolveAndCreateModel(params);

    this.logger.debug(
      `generateTextWithTools: provider=${params.provider}, model=${params.model}, ` +
        `tenantId=${params.tenantId}, agentId=${params.agentId}, maxSteps=${params.maxSteps ?? 1}`
    );

    // Build middleware chain: KB RAG if knowledge bases are configured
    const middlewares = this.buildKbMiddleware(params);
    const wrappedModel =
      middlewares.length > 0
        ? wrapLanguageModel({
            model: languageModel as any,
            middleware: middlewares,
          })
        : languageModel;

    const maxSteps = params.maxSteps ?? 5;
    const defaultLimits: Record<string, number> = { "*": 3 };
    const toolLimits = params.toolLimits ?? defaultLimits;
    const totalLimit = toolLimits["*"] ?? 3;

    // Tool call tracking: global counter across ALL tools and steps
    let totalToolCalls = 0;
    const executedCalls: Array<{
      type: string;
      toolName: string;
      args: Record<string, unknown>;
    }> = [];

    // Wrap each tool's execute function to enforce a GLOBAL tool call limit.
    // This is more reliable than experimental_repairToolCall, which marks
    // rejected calls as "invalid" and produces tool-error responses that
    // cause the LLM to retry, burning tokens and steps.
    const throttledTools: Record<string, Tool> = {};
    if (params.tools) {
      for (const [name, toolDef] of Object.entries(params.tools)) {
        const originalExecute = (toolDef as any).execute;
        throttledTools[name] = {
          ...toolDef,
          execute: originalExecute
            ? async (args: unknown, options?: unknown) => {
                totalToolCalls++;
                if (totalToolCalls > totalLimit) {
                  return {
                    _limitReached: true,
                    message: `Tool call limit of ${totalLimit} reached. Do NOT call any more tools. Summarize what you have so far.`,
                  };
                }
                executedCalls.push({
                  type: "tool-call",
                  toolName: name,
                  args: args as Record<string, unknown>,
                });
                return originalExecute.call(toolDef, args, options);
              }
            : undefined,
        } as Tool;
      }
    }

    // Custom stop condition: stop after a step where total tool calls
    // across ALL steps have reached the limit.
    const stopWhenToolLimit = ({
      steps,
    }: {
      steps: Array<{ toolCalls?: Array<unknown> }>;
    }) => {
      const totalCallsInSteps = steps.reduce(
        (sum, step) => sum + (step.toolCalls?.length ?? 0),
        0
      );
      return totalCallsInSteps >= totalLimit;
    };

    const result = await generateText({
      model: wrappedModel,
      system: params.systemPrompt,
      ...(params.messages
        ? { messages: params.messages }
        : { prompt: params.prompt ?? "" }),
      tools: throttledTools,
      stopWhen: [stepCountIs(maxSteps), stopWhenToolLimit],
      maxOutputTokens: params.maxTokens,
      temperature: params.temperature,
      onStepFinish: params.onStepFinish,
    });

    // Aggregate usage across all steps
    const usage = {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens:
        (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
      cachedInputTokens:
        (result.usage as any)?.inputTokenDetails?.cacheReadTokens ?? 0,
    };

    const costUsd = CostTrackerService.estimateCost(
      params.provider,
      params.model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens ?? 0
    );

    await this.recordCost(params, usage, costUsd);

    this.logger.debug(
      `Tool usage: executed ${executedCalls.length} / limited to ${totalLimit}`
    );

    // Collect tool results across all steps
    const allToolResults = (result.steps ?? []).flatMap((step) =>
      (step.toolResults ?? []).map((tr) => ({
        toolName: tr.toolName,
        args: (tr as any).args as Record<string, unknown>,
        result: (tr as any).result,
        success:
          (tr as any).isError !== undefined ? !(tr as any).isError : undefined,
      }))
    );

    return {
      text: result.text ?? "",
      toolCalls: executedCalls,
      toolResults: allToolResults.length > 0 ? allToolResults : undefined,
      usage,
      provider: params.provider,
      model: params.model,
      costUsd,
    };
  }

  async generateStructuredOutput<T>(
    params: GenerateStructuredOutputParams
  ): Promise<{
    object: T;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    provider: string;
    model: string;
    costUsd: number;
  }> {
    const { model: languageModel } = await this.resolveAndCreateModel(params);

    this.logger.debug(
      `generateStructuredOutput: provider=${params.provider}, model=${params.model}, ` +
        `tenantId=${params.tenantId}, agentId=${params.agentId}`
    );

    const result = await generateObject({
      model: languageModel,
      schema: params.schema,
      ...(params.messages
        ? { messages: params.messages }
        : { prompt: params.prompt ?? "" }),
      system: params.systemPrompt,
      maxOutputTokens: params.maxTokens,
      temperature: params.temperature,
      // mode was removed in v6 - generateObject determines mode from schema/output fields
    });

    const usage = {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens:
        (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
      cachedInputTokens:
        (result.usage as any)?.inputTokenDetails?.cacheReadTokens ?? 0,
    };

    const costUsd = CostTrackerService.estimateCost(
      params.provider,
      params.model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens ?? 0
    );

    await this.recordCost(params, usage, costUsd);

    return {
      object: result.object as T,
      usage,
      provider: params.provider,
      model: params.model,
      costUsd,
    };
  }

  async streamStructuredOutput<T>(
    params: StreamStructuredOutputParams
  ): Promise<{
    partialObjectStream: AsyncIterable<Partial<T>>;
    object: Promise<T>;
    usage: PromiseLike<{
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>;
    provider: string;
    model: string;
  }> {
    const { model: languageModel } = await this.resolveAndCreateModel(params);

    this.logger.debug(
      `streamStructuredOutput: provider=${params.provider}, model=${params.model}, ` +
        `tenantId=${params.tenantId}, agentId=${params.agentId}`
    );

    const result = streamObject({
      model: languageModel,
      schema: params.schema,
      ...(params.messages
        ? { messages: params.messages }
        : { prompt: params.prompt ?? "" }),
      system: params.systemPrompt,
      maxOutputTokens: params.maxTokens,
      temperature: params.temperature,
    });

    const costTrackingUsage = result.usage.then(async (usageResult) => {
      const usage = {
        inputTokens: usageResult?.inputTokens ?? 0,
        outputTokens: usageResult?.outputTokens ?? 0,
        totalTokens:
          (usageResult?.inputTokens ?? 0) + (usageResult?.outputTokens ?? 0),
        cachedInputTokens:
          (usageResult as any)?.inputTokenDetails?.cacheReadTokens ?? 0,
      };
      const costUsd = CostTrackerService.estimateCost(
        params.provider,
        params.model,
        usage.inputTokens,
        usage.outputTokens,
        usage.cachedInputTokens ?? 0
      );
      await this.recordCost(params, usage, costUsd);
      return usage;
    });

    return {
      partialObjectStream: result.partialObjectStream as AsyncIterable<
        Partial<T>
      >,
      object: result.object as Promise<T>,
      usage: costTrackingUsage,
      provider: params.provider,
      model: params.model,
    };
  }

  private buildKbMiddleware(
    params: GenerateTextParams
  ): LanguageModelMiddleware[] {
    const kbIds = params.knowledgeBaseIds ?? [];
    if (kbIds.length === 0 || !this.knowledgeBaseSearchService) {
      return [];
    }
    return [
      createKnowledgeBaseRagMiddleware(
        this.knowledgeBaseSearchService,
        params.tenantId,
        [...kbIds],
        { topK: 5 }
      ),
    ];
  }

  private async resolveAndCreateModel(params: GenerateTextParams): Promise<{
    model: LanguageModel;
    credentials: {
      provider: string;
      model: string;
      apiKey: string;
      baseUrl?: string;
    };
  }> {
    const credentials = await this.credentialResolver.resolve({
      tenantId: params.tenantId,
      agentId: params.agentId,
      provider: params.provider,
      model: params.model,
      credentialId: params.credentialId,
      credentialMode: params.credentialMode as
        | "profile"
        | "runtime-default"
        | "none"
        | "connector"
        | undefined,
      connectorId: params.connectorId,
    });

    const languageModel = this.providerRegistry.createModel(
      credentials.provider,
      credentials.model,
      credentials.apiKey,
      credentials.baseUrl
    );

    return { model: languageModel, credentials };
  }

  private async recordCost(
    params: GenerateTextParams,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
    },
    costUsd: number
  ): Promise<void> {
    const event: ICostEvent = {
      tenantId: params.tenantId,
      agentId: params.agentId,
      executionId: params.executionId,
      model: params.model,
      provider: params.provider,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
      costUsd,
      timestamp: new Date().toISOString(),
    };

    const withinBudget = await this.costTracker.recordCost(event);
    if (!withinBudget) {
      this.logger.warn(
        `Budget exceeded: tenant=${params.tenantId}, agent=${params.agentId}, ` +
          `cost=${costUsd.toFixed(6)} USD`
      );
    }
  }
}
