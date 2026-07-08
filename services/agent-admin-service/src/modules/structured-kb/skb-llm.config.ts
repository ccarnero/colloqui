import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Shared LLM provider/model defaults for the Structured Knowledge Base
 * module. Both the NL→SQL translator (`SKBQueryService`) and the schema
 * analyzer (`SKBSchemaAnalyzerService`) used to hardcode
 * `{ provider: "openai", modelId: "gpt-4o" }` independently — defined once
 * here so there is a single source of truth, overridable per-deployment via
 * env without touching code.
 *
 * Lazy getters (mirroring `src/config.ts`) so tests can set `process.env`
 * before first read.
 */
export const skbLlmConfig = {
  /** LLM provider used for SKB schema analysis and NL→SQL translation. */
  get provider(): string {
    return process.env.SKB_LLM_PROVIDER ?? "openai";
  },
  /** LLM model id used for SKB schema analysis and NL→SQL translation. */
  get modelId(): string {
    return process.env.SKB_LLM_MODEL_ID ?? "gpt-4o";
  },
};

/**
 * Builds a real AI SDK `LanguageModel` for SKB LLM calls. Both SKB call
 * sites used to pass a plain `{ provider, modelId }` object literal into
 * `generateObject` (hidden behind `as any`), which AI SDK 5+ rejects at
 * runtime with "Unsupported model version undefined" — the SKB LLM path
 * never worked. Only the `openai` provider is wired today; other values of
 * `SKB_LLM_PROVIDER` fail fast with an actionable error instead of a
 * misleading SDK message.
 */
export function createSkbLanguageModel(
  provider?: string,
  modelId?: string
): LanguageModel {
  const resolvedProvider = (provider ?? skbLlmConfig.provider).toLowerCase();
  if (resolvedProvider !== "openai") {
    throw new Error(
      `Unsupported SKB LLM provider '${resolvedProvider}': only 'openai' is wired for Structured KB today (set SKB_LLM_PROVIDER=openai)`
    );
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set: the SKB schema analyzer and NL->SQL translator need it to call the LLM"
    );
  }
  const openai = createOpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL,
  });
  return openai(modelId ?? skbLlmConfig.modelId);
}
