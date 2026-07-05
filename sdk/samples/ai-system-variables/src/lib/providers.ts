/**
 * LLM provider helpers — same contract as ai-agent-triage's setup.sh
 * (provider_api_key_var / provider_base_url_var / provider_default_base_url /
 * is_placeholder_secret). Maps a provider name to the env var(s) that carry
 * its credentials and to its default API base URL.
 */

export function providerApiKeyVar(provider: string): string {
  switch (provider.toLowerCase()) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "cohere":
      return "COHERE_API_KEY";
    case "deepseek":
      return "DEEPSEEK_API_KEY";
    case "google":
      return "GOOGLE_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "mistral":
      return "MISTRAL_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "xai":
      return "XAI_API_KEY";
    case "ollama":
      return "OLLAMA_API_KEY";
    default:
      return "";
  }
}

export function providerBaseUrlVar(provider: string): string {
  switch (provider.toLowerCase()) {
    case "anthropic":
      return "ANTHROPIC_BASE_URL";
    case "groq":
      return "GROQ_BASE_URL";
    case "mistral":
      return "MISTRAL_BASE_URL";
    case "openai":
      return "OPENAI_BASE_URL";
    case "ollama":
      return "OLLAMA_BASE_URL";
    case "openrouter":
      return "OPENROUTER_BASE_URL";
    case "xai":
      return "XAI_BASE_URL";
    default:
      return "";
  }
}

export function providerDefaultBaseUrl(provider: string): string {
  switch (provider.toLowerCase()) {
    case "anthropic":
      return "https://api.anthropic.com";
    case "cohere":
      return "https://api.cohere.com/v2";
    case "deepseek":
      return "https://api.deepseek.com";
    case "google":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "mistral":
      return "https://api.mistral.ai/v1";
    case "openai":
      return "https://api.openai.com/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "xai":
      return "https://api.x.ai/v1";
    case "ollama":
      return "http://localhost:11434/v1";
    default:
      return "";
  }
}

export function readEnvValue(key: string): string {
  if (!key) {
    return "";
  }
  return process.env[key] ?? "";
}

export function isPlaceholderSecret(value: string): boolean {
  return (
    value === "sk-..." ||
    value.includes("your-") ||
    value.includes("replace-me") ||
    value.includes("example")
  );
}
