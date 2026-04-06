import { describe, it, expect } from 'bun:test';
import {
  validateProviderPayload,
  isSupportedProvider,
  getProviderSchema,
  maskPayload,
  payloadToRuntimeEnv,
  ALL_PROVIDERS,
  type CredentialProvider,
} from '../../../src/modules/credentials/providers/credential-provider.registry';

describe('Provider Registry', () => {
  describe('isSupportedProvider', () => {
    it('should return true for all supported providers', () => {
      const supported: CredentialProvider[] = [
        'openai',
        'anthropic',
        'google',
        'google-vertex',
        'bedrock',
        'groq',
        'mistral',
        'openrouter',
        'xai',
        'cohere',
        'cerebras',
        'huggingface',
        'mock',
      ];

      for (const provider of supported) {
        expect(isSupportedProvider(provider)).toBe(true);
      }
    });

    it('should return false for unsupported providers', () => {
      expect(isSupportedProvider('unknown')).toBe(false);
      expect(isSupportedProvider('azure')).toBe(false);
      expect(isSupportedProvider('')).toBe(false);
    });

    it('ALL_PROVIDERS should contain all supported providers', () => {
      expect(ALL_PROVIDERS).toHaveLength(13);
      expect(ALL_PROVIDERS).toContain('openai');
      expect(ALL_PROVIDERS).toContain('anthropic');
      expect(ALL_PROVIDERS).toContain('bedrock');
    });
  });

  describe('getProviderSchema', () => {
    it('should return schema for valid providers', () => {
      const openaiSchema = getProviderSchema('openai');
      expect(openaiSchema.provider).toBe('openai');
      expect(openaiSchema.displayName).toBe('OpenAI');
      expect(openaiSchema.fields).toBeDefined();
      expect(openaiSchema.runtimeEnvMapping).toBeDefined();
    });

    it('should throw error for unsupported providers', () => {
      expect(() => getProviderSchema('unknown' as CredentialProvider)).toThrow('Unknown provider');
    });

    it('should have correct fields for OpenAI', () => {
      const schema = getProviderSchema('openai');
      const apiKeyField = schema.fields.find(f => f.name === 'api_key');
      expect(apiKeyField).toBeDefined();
      expect(apiKeyField?.required).toBe(true);
      expect(apiKeyField?.secret).toBe(true);

      const baseUrlField = schema.fields.find(f => f.name === 'base_url');
      expect(baseUrlField).toBeDefined();
      expect(baseUrlField?.required).toBe(false);
      expect(baseUrlField?.type).toBe('url');
    });

    it('should have correct runtime env mapping', () => {
      const schema = getProviderSchema('openai');
      expect(schema.runtimeEnvMapping.api_key).toBe('OPENAI_API_KEY');
      expect(schema.runtimeEnvMapping.base_url).toBe('OPENAI_BASE_URL');
    });

    it('should have correct fields for AWS Bedrock', () => {
      const schema = getProviderSchema('bedrock');
      expect(schema.fields).toHaveLength(4);

      const accessKeyField = schema.fields.find(f => f.name === 'aws_access_key_id');
      expect(accessKeyField?.required).toBe(true);
      expect(accessKeyField?.secret).toBe(true);

      const secretKeyField = schema.fields.find(f => f.name === 'aws_secret_access_key');
      expect(secretKeyField?.required).toBe(true);
      expect(secretKeyField?.secret).toBe(true);
    });
  });

  describe('validateProviderPayload', () => {
    describe('OpenAI', () => {
      it('should validate correct OpenAI payload', () => {
        const payload = { api_key: 'sk-test123456789' };
        const errors = validateProviderPayload('openai', payload);
        expect(errors).toHaveLength(0);
      });

      it('should require api_key for OpenAI', () => {
        const payload = {};
        const errors = validateProviderPayload('openai', payload);
        expect(errors).toHaveLength(1);
        expect(errors[0].field).toBe('api_key');
        expect(errors[0].message).toContain('required');
      });

      it('should reject empty api_key', () => {
        const payload = { api_key: '' };
        const errors = validateProviderPayload('openai', payload);
        expect(errors).toHaveLength(1);
        expect(errors[0].field).toBe('api_key');
      });

      it('should validate optional base_url', () => {
        const payload = {
          api_key: 'sk-test123',
          base_url: 'https://api.openai.com/v1',
        };
        const errors = validateProviderPayload('openai', payload);
        expect(errors).toHaveLength(0);
      });

      it('should reject invalid base_url', () => {
        const payload = {
          api_key: 'sk-test123',
          base_url: 'not-a-url',
        };
        const errors = validateProviderPayload('openai', payload);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.field === 'base_url')).toBe(true);
      });

      it('should reject unsupported fields', () => {
        const payload = {
          api_key: 'sk-test123',
          unsupported_field: 'value',
        };
        const errors = validateProviderPayload('openai', payload);
        expect(errors.some(e => e.field === 'unsupported_field')).toBe(true);
      });
    });

    describe('Google Vertex', () => {
      it('should require service_account_json', () => {
        const payload = { project_id: 'my-project' };
        const errors = validateProviderPayload('google-vertex', payload);
        expect(errors.some(e => e.field === 'service_account_json')).toBe(true);
      });

      it('should validate correct Vertex payload', () => {
        const payload = {
          project_id: 'my-project',
          region: 'us-central1',
          service_account_json: '{"type":"service_account"}',
        };
        const errors = validateProviderPayload('google-vertex', payload);
        expect(errors).toHaveLength(0);
      });

      it('should reject invalid JSON in service_account_json', () => {
        const payload = {
          service_account_json: 'not-valid-json',
        };
        const errors = validateProviderPayload('google-vertex', payload);
        expect(errors.some(e => e.field === 'service_account_json' && e.message.includes('JSON'))).toBe(true);
      });
    });

    describe('AWS Bedrock', () => {
      it('should require AWS credentials', () => {
        const payload = { region: 'us-east-1' };
        const errors = validateProviderPayload('bedrock', payload);
        expect(errors.some(e => e.field === 'aws_access_key_id')).toBe(true);
        expect(errors.some(e => e.field === 'aws_secret_access_key')).toBe(true);
      });

      it('should validate correct Bedrock payload', () => {
        const payload = {
          aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          aws_secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          region: 'us-east-1',
        };
        const errors = validateProviderPayload('bedrock', payload);
        expect(errors).toHaveLength(0);
      });

      it('should accept optional session token', () => {
        const payload = {
          aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          aws_secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          aws_session_token: 'FwoGZXIvYXdzEBYaDK...',
          region: 'us-east-1',
        };
        const errors = validateProviderPayload('bedrock', payload);
        expect(errors).toHaveLength(0);
      });
    });
  });

  describe('maskPayload', () => {
    it('should mask secret fields in payload', () => {
      const payload = {
        api_key: 'sk-secret123',
        base_url: 'https://api.example.com',
      };
      const masked = maskPayload('openai', payload, true);

      expect(masked.api_key).toContain('****');
      expect(masked.api_key).not.toBe('sk-secret123');
      expect(masked.base_url).toBe('https://api.example.com');
    });

    it('should handle short secrets', () => {
      const payload = { api_key: 'abc' };
      const masked = maskPayload('openai', payload, true);
      expect(masked.api_key).toBe('****');
    });

    it('should indicate no secret when hasSecret is false', () => {
      const payload = {};
      const masked = maskPayload('openai', payload, false);
      expect(masked.api_key).toBeNull();
    });

    it('should mask AWS credentials', () => {
      const payload = {
        aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
        aws_secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
      };
      const masked = maskPayload('bedrock', payload, true);

      expect(masked.aws_access_key_id).toContain('****');
      expect(masked.aws_secret_access_key).toContain('****');
      expect(masked.region).toBe('us-east-1');
    });
  });

  describe('payloadToRuntimeEnv', () => {
    it('should convert OpenAI payload to env vars', () => {
      const payload = {
        api_key: 'sk-test123',
        base_url: 'https://api.openai.com/v1',
      };
      const env = payloadToRuntimeEnv('openai', payload);

      expect(env.OPENAI_API_KEY).toBe('sk-test123');
      expect(env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    });

    it('should convert Bedrock payload to env vars', () => {
      const payload = {
        aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
        aws_secret_access_key: 'secret',
        region: 'us-east-1',
      };
      const env = payloadToRuntimeEnv('bedrock', payload);

      expect(env.AWS_ACCESS_KEY_ID).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(env.AWS_SECRET_ACCESS_KEY).toBe('secret');
      expect(env.AWS_REGION).toBe('us-east-1');
    });

    it('should skip undefined/null values', () => {
      const payload = {
        api_key: 'sk-test',
        base_url: null,
        extra: undefined,
      };
      const env = payloadToRuntimeEnv('openai', payload);

      expect(env.OPENAI_API_KEY).toBe('sk-test');
      expect(env.OPENAI_BASE_URL).toBeUndefined();
    });

    it('should stringify non-string values', () => {
      const payload = {
        project_id: 'my-project',
        service_account_json: { type: 'service_account' },
      };
      const env = payloadToRuntimeEnv('google-vertex', payload);

      expect(env.GOOGLE_VERTEX_PROJECT_ID).toBe('my-project');
      expect(env.GOOGLE_APPLICATION_CREDENTIALS_JSON).toBe('{"type":"service_account"}');
    });
  });
});
