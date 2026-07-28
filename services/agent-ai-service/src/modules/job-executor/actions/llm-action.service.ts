import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { EventEnvelope } from "@yoizen/shared";
import { LlmCallEventPublisherService } from "../../llm/llm-call-event-publisher.service";
import { LlmExecutorService } from "../../llm/llm-executor.service";

export interface LlmActionConfig {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly context?: Record<string, unknown>;
}

export interface LlmActionResult {
  readonly content: string;
  readonly model: string;
  readonly provider: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
  readonly costUsd: number;
}

@Injectable()
export class LlmActionService {
  private readonly logger = new PinoLoggerService(LlmActionService.name);

  constructor(
    private readonly llmExecutor: LlmExecutorService,
    private readonly llmCallEventPublisher: LlmCallEventPublisherService
  ) {}

  async execute(
    tenantId: string,
    agentId: string,
    actionConfig: Record<string, unknown>,
    variables: Record<string, unknown> = {},
    executionId = "job-execution",
    /**
     * Incoming envelope from the event that triggered this job, when the
     * caller has one — threaded down from `job-executor.service.ts`'s
     * `executeJob(..., envelope)` so the `ai.llm_call.completed.v1` event
     * (T04 of connection-call-inspector.md) can join the run's causal
     * chain. `undefined` means this job run is a causal root.
     */
    envelope?: EventEnvelope
  ): Promise<LlmActionResult> {
    const promptTemplate = String(actionConfig.prompt ?? "").trim();
    if (!promptTemplate) {
      throw new Error("LLM call action requires a non-empty 'prompt'");
    }

    const prompt = this.renderTemplate(promptTemplate, variables);
    const systemPrompt = actionConfig.system_prompt
      ? String(actionConfig.system_prompt)
      : undefined;
    const provider = String(actionConfig.provider ?? "openai");
    const model = String(actionConfig.model ?? "gpt-4o-mini");
    const maxTokens = actionConfig.max_tokens
      ? Number(actionConfig.max_tokens)
      : undefined;
    const temperature = actionConfig.temperature
      ? Number(actionConfig.temperature)
      : undefined;

    this.logger.log(
      `[llm-action] Executing: tenant='${tenantId}' agent='${agentId}' model='${model}' prompt_len=${prompt.length}`
    );

    const startedAt = Date.now();
    const result = await this.llmExecutor.generateText({
      tenantId,
      agentId,
      executionId,
      provider,
      model,
      systemPrompt,
      prompt,
      maxTokens,
      temperature,
    });
    const durationMs = Date.now() - startedAt;

    this.logger.log(
      `[llm-action] Completed: tokens=${result.usage.totalTokens} cost=${result.costUsd.toFixed(6)} duration_ms=${durationMs}`
    );

    // Standalone LLM call (job-executor `llm_call` action, OUTSIDE chat
    // executions) — emit `ai.llm_call.completed.v1` for the connection call
    // inspector (`manual-loops/connectors/connection-call-inspector.md` T04).
    // Chat executions never route through this file (they go through
    // `SessionChatService`/`execution.handler.ts`, which never depends on
    // `LlmCallEventPublisherService`), so this path never double-captures
    // `execution_completed`'s payload. Fire-and-forget: `publish()` never
    // throws synchronously by design, but the call site is still wrapped in
    // try/catch — capture must NEVER fail or delay the LLM action's result
    // (SPEC constraint), even if the injected publisher misbehaves.
    try {
      this.llmCallEventPublisher.publish({
        tenantId,
        agentId,
        executionId,
        model: result.model,
        provider: result.provider,
        prompt,
        completion: result.text,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        costUsd: result.costUsd,
        durationMs,
        causalEnvelope: envelope,
      });
    } catch (publishError) {
      this.logger.warn(
        `[llm-action] Failed to emit ai.llm_call.completed.v1 event for execution='${executionId}': ${publishError instanceof Error ? publishError.message : String(publishError)}`
      );
    }

    return {
      content: result.text,
      model: result.model,
      provider: result.provider,
      usage: result.usage,
      costUsd: result.costUsd,
    };
  }

  private renderTemplate(
    template: string,
    variables: Record<string, unknown>
  ): string {
    let rendered = template;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      rendered = rendered.replaceAll(placeholder, String(value ?? ""));
    }
    return rendered;
  }
}
