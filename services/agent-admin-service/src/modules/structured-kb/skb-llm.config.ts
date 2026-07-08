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

/** Resolved API credentials for SKB LLM calls. */
export interface SkbLlmCredentials {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Resolves the API key for SKB LLM calls, in precedence order:
 *
 * 1. `provider_connector_id` in the container's `provider_config` JSONB —
 *    fetched from connector-admin-api (same pattern as
 *    `DocumentsService.resolveProviderCredentials`), so tenants can bring
 *    their own key via an HTTP connector instead of a shared env var.
 * 2. `OPENAI_API_KEY` / `OPENAI_BASE_URL` env vars (deployment-wide
 *    fallback, injected from the `openai-credentials` k8s secret in dev).
 *
 * Connector failures degrade to the env fallback with a warning rather
 * than failing the call, mirroring the documents ingestion behavior.
 */
export async function resolveSkbLlmCredentials(
  tenantId: string,
  providerConfig?: Record<string, unknown>,
  logger?: { warn(message: string): void }
): Promise<SkbLlmCredentials> {
  const connectorId = providerConfig?.provider_connector_id;
  if (typeof connectorId === "string" && connectorId.length > 0) {
    try {
      const connectorUrl =
        process.env.CONNECTOR_ADMIN_URL ??
        "http://connector-admin-api.platform-services-dev.svc.cluster.local";
      const res = await fetch(`${connectorUrl}/connectors/${connectorId}`, {
        headers: { "x-yoizen-tenant": tenantId },
      });
      if (!res.ok) {
        logger?.warn(
          `SKB LLM connector fetch failed (${res.status}) for ${connectorId}, falling back to env-var`
        );
      } else {
        const connector = (await res.json()) as {
          baseUrl?: string;
          authConfig?: Record<string, string>;
        };
        const apiKey =
          connector.authConfig?.bearerToken ?? connector.authConfig?.apiKey;
        if (apiKey) {
          return { apiKey, baseUrl: connector.baseUrl };
        }
        logger?.warn(
          `SKB LLM connector ${connectorId} has no bearerToken/apiKey in authConfig, falling back to env-var`
        );
      }
    } catch (err) {
      logger?.warn(
        `Failed to fetch SKB LLM connector ${connectorId}: ${err instanceof Error ? err.message : String(err)}. Falling back to env-var`
      );
    }
  }

  const envApiKey = process.env.OPENAI_API_KEY;
  if (!envApiKey) {
    throw new Error(
      "No SKB LLM API key configured: set OPENAI_API_KEY env var or configure provider_config.provider_connector_id on the container"
    );
  }
  return { apiKey: envApiKey, baseUrl: process.env.OPENAI_BASE_URL };
}

/**
 * Builds a real AI SDK `LanguageModel` for SKB LLM calls. Both SKB call
 * sites used to pass a plain `{ provider, modelId }` object literal into
 * `generateObject` (hidden behind `as any`), which AI SDK 5+ rejects at
 * runtime with "Unsupported model version undefined" — the SKB LLM path
 * never worked. Only the `openai` provider is wired today; other values of
 * `SKB_LLM_PROVIDER` fail fast with an actionable error instead of a
 * misleading SDK message.
 *
 * `credentials` comes from `resolveSkbLlmCredentials()`; when omitted the
 * env vars are read directly (kept for tests and simple deployments).
 */
export function createSkbLanguageModel(
  provider?: string,
  modelId?: string,
  credentials?: SkbLlmCredentials
): LanguageModel {
  const resolvedProvider = (provider ?? skbLlmConfig.provider).toLowerCase();
  if (resolvedProvider !== "openai") {
    throw new Error(
      `Unsupported SKB LLM provider '${resolvedProvider}': only 'openai' is wired for Structured KB today (set SKB_LLM_PROVIDER=openai)`
    );
  }
  const apiKey = credentials?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set: the SKB schema analyzer and NL->SQL translator need it to call the LLM"
    );
  }
  const openai = createOpenAI({
    apiKey,
    baseURL: credentials?.baseUrl ?? process.env.OPENAI_BASE_URL,
  });
  return openai(modelId ?? skbLlmConfig.modelId);
}
