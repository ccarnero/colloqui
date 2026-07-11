import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { Injectable, Logger } from "@nestjs/common";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

// The precise `LanguageModelV3StreamPart` / prompt union types live in the
// internal `@ai-sdk/provider` package, which is not a direct dependency of
// this service (only a transitive one via "ai") and is not re-exported from
// the top-level "ai" package either. Rather than add a fragile direct
// dependency on an internal transitive package purely for type annotations,
// the mock provider's stream chunks/prompt are typed loosely here; the
// runtime shape is exercised end-to-end by this service's provider-registry
// unit tests.
type MockStreamPart = Record<string, unknown> & { type: string };
type MockPromptMessage = {
  role: string;
  content: string | ReadonlyArray<{ type: string; text?: string }>;
};
type MockPrompt = ReadonlyArray<MockPromptMessage>;

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

/**
 * Env flag gating the dev-only `mock` (echo) provider. Must be truthy
 * ("true") to resolve — never set in production. See
 * DOCS/architecture/runtime-streaming.md §5.2.
 */
export const RUNTIME_ALLOW_MOCK_PROVIDER_ENV = "RUNTIME_ALLOW_MOCK_PROVIDER";

@Injectable()
export class ProviderRegistryService {
  private readonly logger = new Logger(ProviderRegistryService.name);

  createModel(
    provider: string,
    model: string,
    apiKey: string,
    baseUrl?: string
  ): LanguageModel {
    const normalizedProvider = provider.toLowerCase();

    if (normalizedProvider === "mock") {
      return this.createMockModel(model);
    }

    if (OPENAI_COMPATIBLE_PROVIDERS.has(normalizedProvider)) {
      return this.createOpenAICompatibleModel(
        normalizedProvider,
        model,
        apiKey,
        baseUrl
      );
    }

    return this.createNativeModel(normalizedProvider, model, apiKey, baseUrl);
  }

  getAvailableProviders(): string[] {
    return [...SUPPORTED_PROVIDERS];
  }

  /**
   * Dev-only echo provider — no credentials, no network calls. Streams the
   * incoming prompt back word-by-word as `text-delta` chunks. Exists purely
   * to exercise the full token-streaming path (agent-ai-service → NATS →
   * ai-agent-gateway → api-gateway → SDK) in dev/CI without real LLM
   * credentials (DOCS/architecture/runtime-streaming.md §5.2).
   *
   * Gated by `RUNTIME_ALLOW_MOCK_PROVIDER=true` — throws otherwise so it can
   * never silently resolve in an environment where it wasn't explicitly
   * opted into (e.g. production).
   */
  private createMockModel(model: string): LanguageModel {
    if (process.env[RUNTIME_ALLOW_MOCK_PROVIDER_ENV] !== "true") {
      throw new Error(
        `The 'mock' LLM provider is disabled. Set ${RUNTIME_ALLOW_MOCK_PROVIDER_ENV}=true ` +
          `to enable it (dev/CI only — never in production).`
      );
    }

    const buildStream = (prompt: MockPrompt) => {
      const promptText = this.extractPromptText(prompt);
      const words =
        promptText.length > 0 ? promptText.split(/(\s+)/) : ["(empty prompt)"];

      const textId = crypto.randomUUID();
      const usage = this.computeMockUsage(promptText, words);

      const chunks: MockStreamPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: textId },
        ...words.map(
          (word): MockStreamPart => ({
            type: "text-delta",
            id: textId,
            delta: word,
          })
        ),
        { type: "text-end", id: textId },
        {
          type: "finish",
          finishReason: "stop",
          usage,
        },
      ];

      return simulateReadableStream({ chunks, chunkDelayInMs: 10 });
    };

    const buildGenerateResult = (prompt: MockPrompt) => {
      const promptText = this.extractPromptText(prompt);
      const words =
        promptText.length > 0 ? promptText.split(/(\s+)/) : ["(empty prompt)"];
      const echoedText = promptText.length > 0 ? promptText : "(empty prompt)";
      const usage = this.computeMockUsage(promptText, words);

      return {
        content: [{ type: "text", text: echoedText }],
        finishReason: "stop",
        usage,
        warnings: [],
      };
    };

    // Cast at the boundary: `MockLanguageModelV3`'s real constructor type
    // requires the internal `LanguageModelV3StreamPart` / `LanguageModelV3GenerateResult`
    // shapes (see the file header comment) which aren't safely importable here
    // without a fragile direct dependency on an internal transitive package.
    // The runtime shapes built above match them exactly and are covered by
    // unit tests.
    return new MockLanguageModelV3({
      provider: "mock",
      modelId: model,
      doStream: (async (options: { prompt: MockPrompt }) => ({
        stream: buildStream(options.prompt),
      })) as unknown as ConstructorParameters<
        typeof MockLanguageModelV3
      >[0] extends infer Opts
        ? Opts extends { doStream?: infer D }
          ? D
          : never
        : never,
      doGenerate: (async (options: { prompt: MockPrompt }) =>
        buildGenerateResult(
          options.prompt
        )) as unknown as ConstructorParameters<
        typeof MockLanguageModelV3
      >[0] extends infer Opts
        ? Opts extends { doGenerate?: infer D }
          ? D
          : never
        : never,
    }) as unknown as LanguageModel;
  }

  /**
   * Plausible input/output token counts for the mock provider's echoed
   * response, shared by both the streaming (`doStream`) and non-streaming
   * (`doGenerate`) code paths so usage reporting stays consistent between
   * them.
   */
  private computeMockUsage(promptText: string, words: string[]) {
    const inputTokenCount = promptText.split(/\s+/).filter(Boolean).length;
    const outputTokenCount = words.filter((w) => w.trim().length > 0).length;
    return {
      inputTokens: {
        total: inputTokenCount,
        noCache: inputTokenCount,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: {
        total: outputTokenCount,
        text: outputTokenCount,
        reasoning: 0,
      },
    };
  }

  private extractPromptText(prompt: MockPrompt): string {
    const lastUser = [...prompt].reverse().find((m) => m.role === "user");
    const message = lastUser ?? prompt[prompt.length - 1];
    if (!message) {
      return "";
    }
    if (typeof message.content === "string") {
      return message.content;
    }
    return message.content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join(" ");
  }

  private createNativeModel(
    provider: string,
    model: string,
    apiKey: string,
    baseUrl?: string
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
            `Supported: ${SUPPORTED_PROVIDERS.join(", ")}`
        );
    }
  }

  private createOpenAICompatibleModel(
    provider: string,
    model: string,
    apiKey: string,
    baseUrl?: string
  ): LanguageModel {
    const resolvedBase =
      baseUrl ?? OPENAI_COMPATIBLE_BASE_URLS[provider] ?? undefined;

    const compatible = createOpenAI({
      apiKey,
      baseURL: resolvedBase,
    });

    this.logger.debug(
      `Creating ${provider} model '${model}' with baseURL: ${resolvedBase ?? "default"}`
    );

    // AI SDK v6 defaults to the Responses API (path: /responses).
    // OpenAI-compatible providers like DeepSeek only support Chat Completions (path: /chat/completions).
    // Using .chat() explicitly ensures we use the chat completions endpoint.
    return compatible.chat(model);
  }

  private createGroqModel(
    model: string,
    apiKey: string,
    baseUrl?: string
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
    baseUrl?: string
  ): LanguageModel {
    const mistral = createOpenAI({
      apiKey,
      baseURL: baseUrl ?? "https://api.mistral.ai/v1",
    });
    return mistral.chat(model);
  }

  private createCohereModel(model: string, apiKey: string): LanguageModel {
    const cohere = createOpenAI({
      apiKey,
      baseURL: "https://api.cohere.com/v2",
    });
    return cohere.chat(model);
  }
}
