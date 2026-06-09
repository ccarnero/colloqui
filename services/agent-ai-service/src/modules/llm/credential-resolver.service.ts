import { Injectable, Logger } from "@nestjs/common";

export interface ResolvedCredentials {
  readonly provider: string;
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
}

export interface CredentialResolutionParams {
  readonly tenantId: string;
  readonly agentId: string;
  readonly provider: string;
  readonly model: string;
  readonly credentialId?: string;
  readonly credentialMode?: "profile" | "runtime-default" | "none" | "connector";
  readonly connectorId?: string;
}

const API_KEY_ENV_BY_PROVIDER: Record<string, readonly string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  cohere: ["CO_API_KEY", "COHERE_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  xai: ["XAI_API_KEY"],
  ollama: ["OLLAMA_API_KEY"],
};

const BASE_URL_ENV_BY_PROVIDER: Record<string, readonly string[]> = {
  anthropic: ["ANTHROPIC_BASE_URL"],
  groq: ["GROQ_BASE_URL"],
  mistral: ["MISTRAL_BASE_URL"],
  openai: ["OPENAI_BASE_URL"],
  ollama: ["OLLAMA_BASE_URL"],
  openrouter: ["OPENROUTER_BASE_URL"],
  xai: ["XAI_BASE_URL"],
};

@Injectable()
export class CredentialResolverService {
  private readonly logger = new Logger(CredentialResolverService.name);

  /**
   * Resolve LLM credentials for a given tenant + agent.
   *
   * Resolution strategies (in priority order):
   * 1. Agent config via credential_id → env lookup (profile mode)
   * 2. Environment variables (runtime-default mode)
   * 3. Connector-admin HTTP API (connector mode) — stub
   */
  async resolve(params: CredentialResolutionParams): Promise<ResolvedCredentials> {
    const { provider, model } = params;
    const normalizedProvider = provider.toLowerCase();
    const mode = params.credentialMode ?? this.inferMode(params);

    this.logger.debug(
      `Resolving credentials for provider=${normalizedProvider}, mode=${mode}, ` +
        `tenantId=${params.tenantId}, agentId=${params.agentId}`,
    );

    let apiKey: string | undefined;
    let baseUrl: string | undefined;

    switch (mode) {
      case "profile":
        ({ apiKey, baseUrl } = this.resolveFromProfile(normalizedProvider, params.credentialId));
        break;

      case "connector":
        ({ apiKey, baseUrl } = await this.resolveFromConnector(params));
        break;

      case "none":
        apiKey = "";
        break;

      case "runtime-default":
      default:
        ({ apiKey, baseUrl } = this.resolveFromEnv(normalizedProvider));
        break;
    }

    if (!apiKey && normalizedProvider !== "ollama") {
      this.logger.warn(
        `No API key resolved for provider='${normalizedProvider}'. ` +
          `LLM calls will likely fail.`,
      );
    }

    return {
      provider: normalizedProvider,
      model,
      apiKey: apiKey ?? "",
      baseUrl,
    };
  }

  private inferMode(params: CredentialResolutionParams): string {
    if (params.connectorId) return "connector";
    if (params.credentialId) return "profile";
    return "runtime-default";
  }

  /**
   * Strategy 1: Profile mode — lookup credential by ID from env.
   * Env key pattern: LLM_CREDENTIAL_{CREDENTIAL_ID}_API_KEY
   */
  private resolveFromProfile(
    provider: string,
    credentialId?: string,
  ): { apiKey?: string; baseUrl?: string } {
    if (!credentialId) {
      this.logger.warn("Profile mode requested but no credentialId provided, falling back to env");
      return this.resolveFromEnv(provider);
    }

    const segment = this.toEnvSegment(credentialId);
    const apiKey = this.readEnv(`LLM_CREDENTIAL_${segment}_API_KEY`);

    const providerDefaultKey = this.readEnv(`LLM_CREDENTIAL_${this.toEnvSegment(provider)}_DEFAULT_API_KEY`);

    const baseUrl = this.readEnv(`LLM_CREDENTIAL_${segment}_BASE_URL`);

    return { apiKey: apiKey ?? providerDefaultKey, baseUrl };
  }

  /**
   * Strategy 2: Runtime-default — read from standard env vars.
   */
  private resolveFromEnv(provider: string): { apiKey?: string; baseUrl?: string } {
    const apiKeyCandidates = API_KEY_ENV_BY_PROVIDER[provider] ?? [];
    const apiKey = this.readFirstEnv(...apiKeyCandidates);

    const baseUrlCandidates = BASE_URL_ENV_BY_PROVIDER[provider] ?? [];
    const baseUrl = this.readFirstEnv(...baseUrlCandidates);

    return { apiKey, baseUrl };
  }

  /**
   * Strategy 3: Connector mode — fetch from connector-admin HTTP API.
   */
  private async resolveFromConnector(
    params: CredentialResolutionParams,
  ): Promise<{ apiKey?: string; baseUrl?: string }> {
    const { tenantId, connectorId, provider, model } = params;

    if (!connectorId) {
      this.logger.warn(
        `[CredentialResolver] connector mode requested but no connectorId provided, falling back to env`,
      );
      return this.resolveFromEnv(provider.toLowerCase());
    }

    try {
      const connectorAdminUrl =
        process.env.CONNECTOR_ADMIN_URL ?? "http://localhost:3001";
      const response = await fetch(
        `${connectorAdminUrl}/connectors/${connectorId}`,
        {
          headers: { "x-yoizen-tenant": tenantId },
        },
      );

      if (!response.ok) {
        this.logger.warn(
          `[CredentialResolver] Failed to fetch connector ${connectorId}: ${response.status}, falling back to env`,
        );
        return this.resolveFromEnv(provider.toLowerCase());
      }

      const connector = (await response.json()) as Record<string, unknown>;

      const baseUrl =
        (connector.base_url as string) ?? (connector.baseUrl as string);

      let apiKey = "";
      const authConfig =
        (connector.auth_config as Record<string, unknown>) ??
        (connector.authConfig as Record<string, unknown>) ??
        {};
      const authType =
        (connector.auth_type as string) ??
        (connector.authType as string) ??
        "none";

      switch (authType) {
        case "bearer":
          apiKey = (authConfig.bearerToken as string) ?? "";
          break;
        case "api-key":
          apiKey =
            (authConfig.apiKey as string) ??
            (authConfig.api_key as string) ??
            "";
          break;
        default:
          this.logger.warn(
            `[CredentialResolver] Unknown auth type '${authType}' for connector ${connectorId}`,
          );
      }

      if (!apiKey) {
        this.logger.warn(
          `[CredentialResolver] No API key found in connector ${connectorId} (authType: ${authType}), falling back to env`,
        );
        return this.resolveFromEnv(provider.toLowerCase());
      }

      this.logger.log(
        `[CredentialResolver] Resolved credentials from connector ${connectorId} for provider=${provider} model=${model}`,
      );
      return { apiKey, baseUrl };
    } catch (err) {
      this.logger.warn(
        `[CredentialResolver] Error fetching connector ${connectorId}: ${(err as Error).message}, falling back to env`,
      );
      return this.resolveFromEnv(provider.toLowerCase());
    }
  }

  private readEnv(key: string): string | undefined {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
    return undefined;
  }

  private readFirstEnv(...keys: readonly string[]): string | undefined {
    for (const key of keys) {
      const value = this.readEnv(key);
      if (value) return value;
    }
    return undefined;
  }

  private toEnvSegment(value: string): string {
    return value
      .replace(/[^a-zA-Z0-9]/g, "_")
      .toUpperCase();
  }
}
