import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
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

  constructor(private readonly llmExecutor: LlmExecutorService) {}

  async execute(
    tenantId: string,
    agentId: string,
    actionConfig: Record<string, unknown>,
    variables: Record<string, unknown> = {},
    executionId = "job-execution",
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
      `[llm-action] Executing: tenant='${tenantId}' agent='${agentId}' model='${model}' prompt_len=${prompt.length}`,
    );

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

    this.logger.log(
      `[llm-action] Completed: tokens=${result.usage.totalTokens} cost=${result.costUsd.toFixed(6)}`,
    );

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
    variables: Record<string, unknown>,
  ): string {
    let rendered = template;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      rendered = rendered.replaceAll(placeholder, String(value ?? ""));
    }
    return rendered;
  }
}
