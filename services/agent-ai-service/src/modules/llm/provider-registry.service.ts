import { Injectable, Logger } from "@nestjs/common";
import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export interface ProviderConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

const OPENAI_COMPATIBLE_PROVIDERS = new Set([
  "openrouter",
  "xai",
  "ollama",
  "groq",
  "mistral",
  "cohere",
  "deepseek",
]);

const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  xai: "https://api.x.ai/v1",
  ollama: "http://localhost:11434/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  cohere: "https://api.cohere.com/v2",
  deepseek: "https://api.deepseek.com",
};

const SUPPORTED_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "groq",
  "mistral",
  "cohere",
  "openrouter",
  "xai",
  "ollama",
  "deepseek",
] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

@Injectable()
export class ProviderRegistryService {
  private readonly logger = new Logger(ProviderRegistryService.name);

  createModel(
    provider: string,
    model: string,
    apiKey: string,
    baseUrl?: string,
  ): LanguageModel {
    const normalizedProvider = provider.toLowerCase();

    if (OPENAI_COMPATIBLE_PROVIDERS.has(normalizedProvider)) {
      return this.createOpenAICompatibleModel(
        normalizedProvider,
        model,
        apiKey,
        baseUrl,
      );
    }

    return this.createNativeModel(normalizedProvider, model, apiKey, baseUrl);
  }

  getAvailableProviders(): string[] {
    return [...SUPPORTED_PROVIDERS];
  }

  private createNativeModel(
    provider: string,
    model: string,
    apiKey: string,
    baseUrl?: string,
  ): LanguageModel {
    switch (provider) {
      case "openai": {
        const openai = createOpenAI({
          apiKey,
          baseURL: baseUrl,
        });
        return openai(model);
      }
      case "anthropic": {
        const anthropic = createAnthropic({
          apiKey,
          baseURL: baseUrl,
        });
        return anthropic(model);
      }
      case "google": {
        const google = createGoogleGenerativeAI({ apiKey });
        return google(model);
      }
      case "groq": {
        return this.createGroqModel(model, apiKey, baseUrl);
      }
      case "mistral": {
        return this.createMistralModel(model, apiKey, baseUrl);
      }
      case "cohere": {
        return this.createCohereModel(model, apiKey);
      }
      default:
        throw new Error(
          `Unsupported LLM provider: '${provider}'. ` +
            `Supported: ${SUPPORTED_PROVIDERS.join(", ")}`,
        );
    }
  }

  private createOpenAICompatibleModel(
    provider: string,
    model: string,
    apiKey: string,
    baseUrl?: string,
  ): LanguageModel {
    const resolvedBase =
      baseUrl ?? OPENAI_COMPATIBLE_BASE_URLS[provider] ?? undefined;

    const compatible = createOpenAI({
      apiKey,
      baseURL: resolvedBase,
    });

    this.logger.debug(
      `Creating ${provider} model '${model}' with baseURL: ${resolvedBase ?? "default"}`,
    );

    // AI SDK v6 defaults to the Responses API (path: /responses).
    // OpenAI-compatible providers like DeepSeek only support Chat Completions (path: /chat/completions).
    // Using .chat() explicitly ensures we use the chat completions endpoint.
    return compatible.chat(model);
  }

  private createGroqModel(
    model: string,
    apiKey: string,
    baseUrl?: string,
  ): LanguageModel {
    const groq = createOpenAI({
      apiKey,
      baseURL: baseUrl ?? "https://api.groq.com/openai/v1",
    });
    return groq.chat(model);
  }

  private createMistralModel(
    model: string,
    apiKey: string,
    baseUrl?: string,
  ): LanguageModel {
    const mistral = createOpenAI({
      apiKey,
      baseURL: baseUrl ?? "https://api.mistral.ai/v1",
    });
    return mistral.chat(model);
  }

  private createCohereModel(
    model: string,
    apiKey: string,
  ): LanguageModel {
    const cohere = createOpenAI({
      apiKey,
      baseURL: "https://api.cohere.com/v2",
    });
    return cohere.chat(model);
  }
}