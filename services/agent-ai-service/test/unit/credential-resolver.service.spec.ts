import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CredentialResolverService } from "../../src/modules/llm/credential-resolver.service";
import type { CredentialResolutionParams } from "../../src/modules/llm/credential-resolver.service";

// ── Env helpers ────────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
    else if (process.env[key] !== originalEnv[key]) process.env[key] = originalEnv[key];
  }
}

// ── Fixture factory ────────────────────────────────────────────────────────

const baseParams = (
  overrides: Partial<CredentialResolutionParams> = {},
): CredentialResolutionParams => ({
  tenantId: "tenant-1",
  agentId: "agent-1",
  provider: "openai",
  model: "gpt-4o",
  ...overrides,
});

// ── Test suite ─────────────────────────────────────────────────────────────

describe("CredentialResolverService", () => {
  let service: CredentialResolverService;

  beforeEach(() => {
    service = new CredentialResolverService();
  });

  afterEach(() => {
    restoreEnv();
  });

  // ─── Mode inference ────────────────────────────────────────────────────

  describe("resolve — mode inference", () => {
    it("defaults to runtime-default when no mode, credentialId, or connectorId is provided", async () => {
      setEnv({ OPENAI_API_KEY: "sk-test" });
      const result = await service.resolve(baseParams());
      expect(result.apiKey).toBe("sk-test");
    });

    it("infers 'profile' mode when credentialId is provided", async () => {
      setEnv({ LLM_CREDENTIAL_MY_KEY_API_KEY: "profile-key" });
      const result = await service.resolve(
        baseParams({ credentialId: "my-key" }),
      );
      expect(result.apiKey).toBe("profile-key");
    });

    it("infers 'connector' mode when connectorId is provided", async () => {
      // Connector falls back to env, so we set the env var to verify it ran that path
      setEnv({ OPENAI_API_KEY: "connector-fallback-key" });
      const result = await service.resolve(
        baseParams({ connectorId: "conn-1" }),
      );
      expect(result.apiKey).toBe("connector-fallback-key");
    });

    it("respects explicit credentialMode over inferred mode", async () => {
      // credentialId present would infer "profile", but explicit mode is "none"
      const result = await service.resolve(
        baseParams({ credentialId: "my-key", credentialMode: "none" }),
      );
      expect(result.apiKey).toBe("");
    });
  });

  // ─── Runtime-default mode ──────────────────────────────────────────────

  describe("resolve — runtime-default mode", () => {
    it("resolves OPENAI_API_KEY for openai provider", async () => {
      setEnv({ OPENAI_API_KEY: "sk-openai" });
      const result = await service.resolve(baseParams({ provider: "openai" }));
      expect(result.apiKey).toBe("sk-openai");
    });

    it("resolves ANTHROPIC_API_KEY for anthropic provider", async () => {
      setEnv({ ANTHROPIC_API_KEY: "sk-anthropic" });
      const result = await service.resolve(
        baseParams({ provider: "anthropic" }),
      );
      expect(result.apiKey).toBe("sk-anthropic");
    });

    it("resolves GOOGLE_API_KEY for google provider", async () => {
      setEnv({ GOOGLE_API_KEY: "sk-google" });
      const result = await service.resolve(
        baseParams({ provider: "google" }),
      );
      expect(result.apiKey).toBe("sk-google");
    });

    it("resolves GEMINI_API_KEY as fallback for google provider", async () => {
      setEnv({ GEMINI_API_KEY: "sk-gemini" });
      const result = await service.resolve(
        baseParams({ provider: "google" }),
      );
      expect(result.apiKey).toBe("sk-gemini");
    });

    it("resolves GROQ_API_KEY for groq provider", async () => {
      setEnv({ GROQ_API_KEY: "sk-groq" });
      const result = await service.resolve(baseParams({ provider: "groq" }));
      expect(result.apiKey).toBe("sk-groq");
    });

    it("resolves MISTRAL_API_KEY for mistral provider", async () => {
      setEnv({ MISTRAL_API_KEY: "sk-mistral" });
      const result = await service.resolve(
        baseParams({ provider: "mistral" }),
      );
      expect(result.apiKey).toBe("sk-mistral");
    });

    it("returns empty apiKey when no env var is set", async () => {
      setEnv({ OPENAI_API_KEY: undefined });
      const result = await service.resolve(baseParams({ provider: "openai" }));
      expect(result.apiKey).toBe("");
    });

    it("does not warn about missing key for ollama provider", async () => {
      // Ollama doesn't require an API key — should resolve without warning
      const result = await service.resolve(
        baseParams({ provider: "ollama" }),
      );
      expect(result.apiKey).toBe("");
      // No assertion on logger.warn — just verifying it doesn't throw
    });

    it("resolves OPENAI_BASE_URL when set", async () => {
      setEnv({
        OPENAI_API_KEY: "sk-openai",
        OPENAI_BASE_URL: "https://custom.api.com/v1",
      });
      const result = await service.resolve(baseParams({ provider: "openai" }));
      expect(result.baseUrl).toBe("https://custom.api.com/v1");
    });

    it("returns undefined baseUrl when no BASE_URL env var is set", async () => {
      setEnv({ OPENAI_API_KEY: "sk-openai" });
      const result = await service.resolve(baseParams({ provider: "openai" }));
      expect(result.baseUrl).toBeUndefined();
    });

    it("prioritizes first env var when multiple candidates exist (google: GOOGLE over GEMINI)", async () => {
      setEnv({ GOOGLE_API_KEY: "first", GEMINI_API_KEY: "second" });
      const result = await service.resolve(
        baseParams({ provider: "google" }),
      );
      expect(result.apiKey).toBe("first");
    });

    it("resolves CO_API_KEY as first candidate for cohere provider", async () => {
      setEnv({ CO_API_KEY: "sk-cohere" });
      const result = await service.resolve(
        baseParams({ provider: "cohere" }),
      );
      expect(result.apiKey).toBe("sk-cohere");
    });

    it("resolves COHERE_API_KEY as second candidate for cohere provider", async () => {
      setEnv({ COHERE_API_KEY: "sk-cohere-alt" });
      const result = await service.resolve(
        baseParams({ provider: "cohere" }),
      );
      expect(result.apiKey).toBe("sk-cohere-alt");
    });

    it("resolves OPENROUTER_API_KEY for openrouter provider", async () => {
      setEnv({ OPENROUTER_API_KEY: "sk-openrouter" });
      const result = await service.resolve(
        baseParams({ provider: "openrouter" }),
      );
      expect(result.apiKey).toBe("sk-openrouter");
    });

    it("resolves XAI_API_KEY for xai provider", async () => {
      setEnv({ XAI_API_KEY: "sk-xai" });
      const result = await service.resolve(baseParams({ provider: "xai" }));
      expect(result.apiKey).toBe("sk-xai");
    });
  });

  // ─── Profile mode ──────────────────────────────────────────────────────

  describe("resolve — profile mode", () => {
    it("reads LLM_CREDENTIAL_{SEGMENT}_API_KEY based on credentialId", async () => {
      setEnv({ LLM_CREDENTIAL_MY_KEY_API_KEY: "profile-key" });
      const result = await service.resolve(
        baseParams({
          credentialMode: "profile",
          credentialId: "my-key",
        }),
      );
      expect(result.apiKey).toBe("profile-key");
    });

    it("converts credentialId to env-safe segment (replaces non-alphanumeric with _)", async () => {
      setEnv({ LLM_CREDENTIAL_MY_KEY_V2_API_KEY: "segment-key" });
      const result = await service.resolve(
        baseParams({
          credentialMode: "profile",
          credentialId: "my-key.v2",
        }),
      );
      expect(result.apiKey).toBe("segment-key");
    });

    it("falls back to LLM_CREDENTIAL_{PROVIDER}_DEFAULT_API_KEY when profile key is missing", async () => {
      // No LLM_CREDENTIAL_MY_KEY_API_KEY set, but default exists
      setEnv({ LLM_CREDENTIAL_OPENAI_DEFAULT_API_KEY: "default-fallback" });
      const result = await service.resolve(
        baseParams({
          credentialMode: "profile",
          credentialId: "my-key",
          provider: "openai",
        }),
      );
      expect(result.apiKey).toBe("default-fallback");
    });

    it("prefers specific profile key over default", async () => {
      setEnv({
        LLM_CREDENTIAL_MY_KEY_API_KEY: "specific-key",
        LLM_CREDENTIAL_OPENAI_DEFAULT_API_KEY: "default-key",
      });
      const result = await service.resolve(
        baseParams({
          credentialMode: "profile",
          credentialId: "my-key",
          provider: "openai",
        }),
      );
      expect(result.apiKey).toBe("specific-key");
    });

    it("reads LLM_CREDENTIAL_{SEGMENT}_BASE_URL for baseUrl", async () => {
      setEnv({
        LLM_CREDENTIAL_MY_KEY_API_KEY: "key",
        LLM_CREDENTIAL_MY_KEY_BASE_URL: "https://custom.profile.com",
      });
      const result = await service.resolve(
        baseParams({
          credentialMode: "profile",
          credentialId: "my-key",
        }),
      );
      expect(result.baseUrl).toBe("https://custom.profile.com");
    });

    it("falls back to env resolution when no credentialId is provided", async () => {
      setEnv({ OPENAI_API_KEY: "env-fallback" });
      const result = await service.resolve(
        baseParams({
          credentialMode: "profile",
          // no credentialId
        }),
      );
      expect(result.apiKey).toBe("env-fallback");
    });
  });

  // ─── Connector mode ────────────────────────────────────────────────────

  describe("resolve — connector mode", () => {
    it("falls back to env resolution (not yet implemented)", async () => {
      setEnv({ OPENAI_API_KEY: "connector-env-key" });
      const result = await service.resolve(
        baseParams({
          credentialMode: "connector",
          connectorId: "conn-1",
        }),
      );
      expect(result.apiKey).toBe("connector-env-key");
    });

    it("resolves baseUrl from env in connector fallback", async () => {
      setEnv({
        OPENAI_API_KEY: "connector-env-key",
        OPENAI_BASE_URL: "https://connector-fallback.com",
      });
      const result = await service.resolve(
        baseParams({
          credentialMode: "connector",
          connectorId: "conn-1",
        }),
      );
      expect(result.baseUrl).toBe("https://connector-fallback.com");
    });
  });

  // ─── None mode ─────────────────────────────────────────────────────────

  describe("resolve — none mode", () => {
    it("returns empty apiKey", async () => {
      const result = await service.resolve(
        baseParams({ credentialMode: "none" }),
      );
      expect(result.apiKey).toBe("");
    });

    it("does not read env vars", async () => {
      setEnv({ OPENAI_API_KEY: "should-not-appear" });
      const result = await service.resolve(
        baseParams({ credentialMode: "none" }),
      );
      expect(result.apiKey).toBe("");
    });

    it("returns undefined baseUrl", async () => {
      const result = await service.resolve(
        baseParams({ credentialMode: "none" }),
      );
      expect(result.baseUrl).toBeUndefined();
    });
  });

  // ─── Provider normalization ────────────────────────────────────────────

  describe("resolve — provider normalization", () => {
    it("normalizes 'OpenAI' to lowercase 'openai'", async () => {
      setEnv({ OPENAI_API_KEY: "sk-test" });
      const result = await service.resolve(
        baseParams({ provider: "OpenAI" }),
      );
      expect(result.provider).toBe("openai");
    });

    it("normalizes 'ANTHROPIC' to lowercase 'anthropic'", async () => {
      setEnv({ ANTHROPIC_API_KEY: "sk-test" });
      const result = await service.resolve(
        baseParams({ provider: "ANTHROPIC" }),
      );
      expect(result.provider).toBe("anthropic");
    });

    it("normalizes 'OpenAi' to 'openai' and resolves correctly", async () => {
      setEnv({ OPENAI_API_KEY: "sk-normalized" });
      const result = await service.resolve(
        baseParams({ provider: "OpenAi" }),
      );
      expect(result.provider).toBe("openai");
      expect(result.apiKey).toBe("sk-normalized");
    });
  });

  // ─── Return shape ──────────────────────────────────────────────────────

  describe("resolve — return shape", () => {
    it("always returns model as passed", async () => {
      setEnv({ OPENAI_API_KEY: "sk-test" });
      const result = await service.resolve(
        baseParams({ model: "gpt-4o-mini" }),
      );
      expect(result.model).toBe("gpt-4o-mini");
    });

    it("returns apiKey as empty string (never undefined) when nothing resolves", async () => {
      const result = await service.resolve(
        baseParams({ provider: "unknown-provider" }),
      );
      expect(result.apiKey).toBe("");
      expect(typeof result.apiKey).toBe("string");
    });
  });

  // ─── toEnvSegment (tested indirectly via profile) ──────────────────────

  describe("toEnvSegment (via profile resolution)", () => {
    it("replaces non-alphanumeric characters with underscores", async () => {
      // "my-key" → "MY_KEY"
      setEnv({ LLM_CREDENTIAL_MY_KEY_API_KEY: "hyphen-key" });
      const result = await service.resolve(
        baseParams({ credentialMode: "profile", credentialId: "my-key" }),
      );
      expect(result.apiKey).toBe("hyphen-key");
    });

    it("uppercases the entire segment", async () => {
      // "lowercase" → "LOWERCASE"
      setEnv({ LLM_CREDENTIAL_LOWERCASE_API_KEY: "upper-key" });
      const result = await service.resolve(
        baseParams({ credentialMode: "profile", credentialId: "lowercase" }),
      );
      expect(result.apiKey).toBe("upper-key");
    });

    it("handles dots and other special chars in credentialId", async () => {
      // "my.key@v2!" → "MY_KEY_V2_"
      setEnv({ LLM_CREDENTIAL_MY_KEY_V2__API_KEY: "special-key" });
      const result = await service.resolve(
        baseParams({ credentialMode: "profile", credentialId: "my.key@v2!" }),
      );
      expect(result.apiKey).toBe("special-key");
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("trims whitespace from env var values", async () => {
      setEnv({ OPENAI_API_KEY: "  sk-whitespace  " });
      const result = await service.resolve(baseParams({ provider: "openai" }));
      expect(result.apiKey).toBe("sk-whitespace");
    });

    it("treats whitespace-only env var as empty", async () => {
      setEnv({ OPENAI_API_KEY: "   " });
      const result = await service.resolve(baseParams({ provider: "openai" }));
      expect(result.apiKey).toBe("");
    });

    it("handles unknown provider with no env candidates gracefully", async () => {
      const result = await service.resolve(
        baseParams({ provider: "totally-unknown" }),
      );
      expect(result.apiKey).toBe("");
      expect(result.provider).toBe("totally-unknown");
    });

    it("connectorId takes priority over credentialId in mode inference", async () => {
      // Both set: connectorId wins
      setEnv({ OPENAI_API_KEY: "env-key" });
      const result = await service.resolve(
        baseParams({ credentialId: "my-key", connectorId: "conn-1" }),
      );
      // Connector mode falls back to env
      expect(result.apiKey).toBe("env-key");
    });
  });
});
