/**
 * Credential Provider Registry
 *
 * Defines all supported LLM providers and their schemas for YoizenClaw.
 * This registry is the single source of truth for provider-aware credentials.
 *
 * Schema version: 1
 */

export type CredentialProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'google-vertex'
  | 'bedrock'
  | 'groq'
  | 'mistral'
  | 'openrouter'
  | 'xai'
  | 'cohere'
  | 'cerebras'
  | 'huggingface'
  | 'mock';

export interface ProviderField {
  name: string;
  type: 'string' | 'url' | 'enum' | 'json';
  required: boolean;
  secret: boolean;
  description: string;
  placeholder?: string;
  options?: string[]; // For enum types
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
  };
}

export interface ProviderSchema {
  provider: CredentialProvider;
  displayName: string;
  description: string;
  fields: ProviderField[];
  runtimeEnvMapping: Record<string, string>; // Maps provider fields to runtime env vars
}

// Field definitions for reuse
const API_KEY_FIELD: ProviderField = {
  name: 'api_key',
  type: 'string',
  required: true,
  secret: true,
  description: 'API key for authentication',
  placeholder: 'sk-...',
};

const BASE_URL_FIELD: ProviderField = {
  name: 'base_url',
  type: 'url',
  required: false,
  secret: false,
  description: 'Custom base URL for the API endpoint',
  placeholder: 'https://api.example.com/v1',
};

const REGION_FIELD: ProviderField = {
  name: 'region',
  type: 'string',
  required: false,
  secret: false,
  description: 'AWS or cloud region',
  placeholder: 'us-east-1',
};

const PROJECT_ID_FIELD: ProviderField = {
  name: 'project_id',
  type: 'string',
  required: false,
  secret: false,
  description: 'Cloud project identifier',
  placeholder: 'my-project-123',
};

// Provider schemas
const OPENAI_SCHEMA: ProviderSchema = {
  provider: 'openai',
  displayName: 'OpenAI',
  description: 'OpenAI GPT models (GPT-4, GPT-3.5, etc.)',
  fields: [
    API_KEY_FIELD,
    BASE_URL_FIELD,
  ],
  runtimeEnvMapping: {
    api_key: 'OPENAI_API_KEY',
    base_url: 'OPENAI_BASE_URL',
  },
};

const ANTHROPIC_SCHEMA: ProviderSchema = {
  provider: 'anthropic',
  displayName: 'Anthropic',
  description: 'Anthropic Claude models',
  fields: [
    API_KEY_FIELD,
    BASE_URL_FIELD,
  ],
  runtimeEnvMapping: {
    api_key: 'ANTHROPIC_API_KEY',
    base_url: 'ANTHROPIC_BASE_URL',
  },
};

const GOOGLE_SCHEMA: ProviderSchema = {
  provider: 'google',
  displayName: 'Google AI (Gemini)',
  description: 'Google Gemini models via AI Studio',
  fields: [
    API_KEY_FIELD,
  ],
  runtimeEnvMapping: {
    api_key: 'GOOGLE_API_KEY',
  },
};

const GOOGLE_VERTEX_SCHEMA: ProviderSchema = {
  provider: 'google-vertex',
  displayName: 'Google Vertex AI',
  description: 'Google Vertex AI with service account authentication',
  fields: [
    {
      name: 'project_id',
      type: 'string',
      required: true,
      secret: false,
      description: 'Google Cloud project ID',
      placeholder: 'my-gcp-project',
    },
    {
      name: 'region',
      type: 'string',
      required: false,
      secret: false,
      description: 'Vertex AI region',
      placeholder: 'us-central1',
    },
    {
      name: 'service_account_json',
      type: 'json',
      required: true,
      secret: true,
      description: 'Google Cloud service account JSON key',
      placeholder: '{ "type": "service_account", ... }',
    },
  ],
  runtimeEnvMapping: {
    project_id: 'GOOGLE_VERTEX_PROJECT_ID',
    region: 'GOOGLE_VERTEX_REGION',
    service_account_json: 'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  },
};

const BEDROCK_SCHEMA: ProviderSchema = {
  provider: 'bedrock',
  displayName: 'AWS Bedrock',
  description: 'Amazon Bedrock with AWS credentials',
  fields: [
    {
      name: 'aws_access_key_id',
      type: 'string',
      required: true,
      secret: true,
      description: 'AWS Access Key ID',
      placeholder: 'AKIA...',
    },
    {
      name: 'aws_secret_access_key',
      type: 'string',
      required: true,
      secret: true,
      description: 'AWS Secret Access Key',
      placeholder: '...',
    },
    {
      name: 'aws_session_token',
      type: 'string',
      required: false,
      secret: true,
      description: 'AWS Session Token (for temporary credentials)',
      placeholder: 'FwoGZXIvYXdzEBYa...',
    },
    REGION_FIELD,
  ],
  runtimeEnvMapping: {
    aws_access_key_id: 'AWS_ACCESS_KEY_ID',
    aws_secret_access_key: 'AWS_SECRET_ACCESS_KEY',
    aws_session_token: 'AWS_SESSION_TOKEN',
    region: 'AWS_REGION',
  },
};

const GROQ_SCHEMA: ProviderSchema = {
  provider: 'groq',
  displayName: 'Groq',
  description: 'Groq ultra-fast inference',
  fields: [
    API_KEY_FIELD,
  ],
  runtimeEnvMapping: {
    api_key: 'GROQ_API_KEY',
  },
};

const MISTRAL_SCHEMA: ProviderSchema = {
  provider: 'mistral',
  displayName: 'Mistral AI',
  description: 'Mistral AI models',
  fields: [
    API_KEY_FIELD,
    BASE_URL_FIELD,
  ],
  runtimeEnvMapping: {
    api_key: 'MISTRAL_API_KEY',
    base_url: 'MISTRAL_BASE_URL',
  },
};

const OPENROUTER_SCHEMA: ProviderSchema = {
  provider: 'openrouter',
  displayName: 'OpenRouter',
  description: 'OpenRouter unified API for multiple providers',
  fields: [
    API_KEY_FIELD,
    BASE_URL_FIELD,
  ],
  runtimeEnvMapping: {
    api_key: 'OPENROUTER_API_KEY',
    base_url: 'OPENROUTER_BASE_URL',
  },
};

const XAI_SCHEMA: ProviderSchema = {
  provider: 'xai',
  displayName: 'xAI (Grok)',
  description: 'xAI Grok models',
  fields: [
    API_KEY_FIELD,
  ],
  runtimeEnvMapping: {
    api_key: 'XAI_API_KEY',
  },
};

const COHERE_SCHEMA: ProviderSchema = {
  provider: 'cohere',
  displayName: 'Cohere',
  description: 'Cohere command and embed models',
  fields: [
    API_KEY_FIELD,
  ],
  runtimeEnvMapping: {
    api_key: 'COHERE_API_KEY',
  },
};

const CEREBRAS_SCHEMA: ProviderSchema = {
  provider: 'cerebras',
  displayName: 'Cerebras',
  description: 'Cerebras inference',
  fields: [
    API_KEY_FIELD,
  ],
  runtimeEnvMapping: {
    api_key: 'CEREBRAS_API_KEY',
  },
};

const HUGGINGFACE_SCHEMA: ProviderSchema = {
  provider: 'huggingface',
  displayName: 'Hugging Face',
  description: 'Hugging Face Inference API',
  fields: [
    API_KEY_FIELD,
    BASE_URL_FIELD,
  ],
  runtimeEnvMapping: {
    api_key: 'HUGGINGFACE_API_KEY',
    base_url: 'HUGGINGFACE_API_BASE',
  },
};

const MOCK_SCHEMA: ProviderSchema = {
  provider: 'mock',
  displayName: 'Mock Provider',
  description: 'Mock provider for testing purposes',
  fields: [
    {
      name: 'mock_response',
      type: 'string',
      required: false,
      secret: false,
      description: 'Optional mock response content',
      placeholder: 'Mock response text',
    },
  ],
  runtimeEnvMapping: {
    mock_response: 'MOCK_PROVIDER_RESPONSE',
  },
};

// Registry map
const PROVIDER_REGISTRY: Record<CredentialProvider, ProviderSchema> = {
  openai: OPENAI_SCHEMA,
  anthropic: ANTHROPIC_SCHEMA,
  google: GOOGLE_SCHEMA,
  'google-vertex': GOOGLE_VERTEX_SCHEMA,
  bedrock: BEDROCK_SCHEMA,
  groq: GROQ_SCHEMA,
  mistral: MISTRAL_SCHEMA,
  openrouter: OPENROUTER_SCHEMA,
  xai: XAI_SCHEMA,
  cohere: COHERE_SCHEMA,
  cerebras: CEREBRAS_SCHEMA,
  huggingface: HUGGINGFACE_SCHEMA,
  mock: MOCK_SCHEMA,
};

// Export all providers as array
export const ALL_PROVIDERS: CredentialProvider[] = Object.keys(
  PROVIDER_REGISTRY
) as CredentialProvider[];

// Export schemas
export const PROVIDER_SCHEMAS: ProviderSchema[] = Object.values(PROVIDER_REGISTRY);

/**
 * Get schema for a specific provider
 */
export function getProviderSchema(provider: CredentialProvider): ProviderSchema {
  const schema = PROVIDER_REGISTRY[provider];
  if (!schema) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return schema;
}

/**
 * Check if a provider is supported
 */
export function isSupportedProvider(provider: string): provider is CredentialProvider {
  return provider in PROVIDER_REGISTRY;
}

/**
 * Validate a provider payload against its schema
 * Returns array of validation errors, empty if valid
 */
export function validateProviderPayload(
  provider: CredentialProvider,
  payload: Record<string, unknown>
): Array<{ field: string; message: string }> {
  const schema = getProviderSchema(provider);
  const errors: Array<{ field: string; message: string }> = [];

  for (const field of schema.fields) {
    const value = payload[field.name];

    // Check required fields
    if (field.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field: field.name,
        message: `${field.name} is required for ${provider} provider`,
      });
      continue;
    }

    // Skip validation for optional empty fields
    if (!field.required && (value === undefined || value === null || value === '')) {
      continue;
    }

    // Type validation
    if (field.type === 'url' && typeof value === 'string') {
      try {
        new URL(value);
      } catch {
        errors.push({
          field: field.name,
          message: `${field.name} must be a valid URL`,
        });
      }
    }

    if (field.type === 'json' && typeof value === 'string') {
      try {
        JSON.parse(value);
      } catch {
        errors.push({
          field: field.name,
          message: `${field.name} must be valid JSON`,
        });
      }
    }

    // String validation
    if (typeof value === 'string') {
      if (field.validation?.minLength && value.length < field.validation.minLength) {
        errors.push({
          field: field.name,
          message: `${field.name} must be at least ${field.validation.minLength} characters`,
        });
      }
      if (field.validation?.maxLength && value.length > field.validation.maxLength) {
        errors.push({
          field: field.name,
          message: `${field.name} must be at most ${field.validation.maxLength} characters`,
        });
      }
      if (field.validation?.pattern && !field.validation.pattern.test(value)) {
        errors.push({
          field: field.name,
          message: `${field.name} has an invalid format`,
        });
      }
    }
  }

  // Check for unsupported fields
  const allowedFields = new Set(schema.fields.map((f) => f.name));
  for (const key of Object.keys(payload)) {
    if (!allowedFields.has(key)) {
      errors.push({
        field: key,
        message: `Field '${key}' is not supported for ${provider} provider`,
      });
    }
  }

  return errors;
}

/**
 * Get secret fields for a provider
 */
export function getSecretFields(provider: CredentialProvider): string[] {
  const schema = getProviderSchema(provider);
  return schema.fields.filter((f) => f.secret).map((f) => f.name);
}

/**
 * Mask a payload for API responses (replaces secrets with masked values)
 */
export function maskPayload(
  provider: CredentialProvider,
  payload: Record<string, unknown>,
  hasSecret: boolean
): Record<string, unknown> {
  const secretFields = getSecretFields(provider);
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (secretFields.includes(key) && value) {
      // Mask secret values
      if (typeof value === 'string' && value.length > 8) {
        masked[key] = value.slice(0, 4) + '****' + value.slice(-4);
      } else {
        masked[key] = '****';
      }
    } else {
      masked[key] = value;
    }
  }

  // Add metadata about secret presence
  for (const field of secretFields) {
    if (!(field in masked)) {
      masked[field] = hasSecret ? '********' : null;
    }
  }

  return masked;
}

/**
 * Get runtime environment variable mapping for a provider
 */
export function getRuntimeEnvMapping(
  provider: CredentialProvider
): Record<string, string> {
  const schema = getProviderSchema(provider);
  return schema.runtimeEnvMapping;
}

/**
 * Transform provider payload to runtime environment variables
 */
export function payloadToRuntimeEnv(
  provider: CredentialProvider,
  payload: Record<string, unknown>
): Record<string, string> {
  const mapping = getRuntimeEnvMapping(provider);
  const env: Record<string, string> = {};

  for (const [field, envVar] of Object.entries(mapping)) {
    const value = payload[field];
    if (value !== undefined && value !== null) {
      env[envVar] = typeof value === 'string' ? value : JSON.stringify(value);
    }
  }

  return env;
}
