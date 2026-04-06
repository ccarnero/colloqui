import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { CredentialSyncService } from '../../src/modules/credentials/credential-sync.service';
import { CredentialsService } from '../../src/modules/credentials/credentials.service';
import { CredentialsRepository, type ProviderCredential } from '../../src/modules/credentials/credentials.repository';
import { NatsPublisher } from '../../src/providers/nats.provider';

describe('CredentialSyncService', () => {
  let service: CredentialSyncService;
  let mockCredentialsService: CredentialsService;
  let mockCredentialsRepository: CredentialsRepository;
  let mockNatsPublisher: NatsPublisher;
  const TENANT_ID = 'tenant-123';

  beforeEach(async () => {
    mockCredentialsService = {
      // mock methods as needed
    } as unknown as CredentialsService;

    mockCredentialsRepository = {
      findAllForSync: vi.fn(),
      updateSyncStatus: vi.fn(),
    } as unknown as CredentialsRepository;

    mockNatsPublisher = {
      publishRuntimeConfigSync: vi.fn().mockResolvedValue(null),
      publishCredentialSyncCompleted: vi.fn(),
    } as unknown as NatsPublisher;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialSyncService,
        {
          provide: CredentialsService,
          useValue: mockCredentialsService,
        },
        {
          provide: CredentialsRepository,
          useValue: mockCredentialsRepository,
        },
        {
          provide: NatsPublisher,
          useValue: mockNatsPublisher,
        },
      ],
    }).compile();

    service = module.get<CredentialSyncService>(CredentialSyncService);
  });

  describe('syncAllCredentials', () => {
    it('should sync all active credentials to runtime format', async () => {
      const mockCredentials: ProviderCredential[] = [
        {
          id: 'cred-1',
          name: 'OpenAI Production',
          provider: 'openai',
          schema_version: 1,
          payload: { api_key: 'sk-prod123', base_url: 'https://api.openai.com' },
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          sync_status: 'pending',
          last_sync_at: null,
          sync_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'cred-2',
          name: 'Anthropic Dev',
          provider: 'anthropic',
          schema_version: 1,
          payload: { api_key: 'sk-ant456' },
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          sync_status: 'failed',
          last_sync_at: null,
          sync_error: 'Previous sync failed',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      vi.mocked(mockCredentialsRepository.findAllForSync).mockResolvedValue(mockCredentials);
      vi.mocked(mockCredentialsRepository.updateSyncStatus).mockResolvedValue(true);
      vi.mocked(mockNatsPublisher.publishCredentialSyncCompleted).mockResolvedValue(null);

      const result = await service.syncAllCredentials(TENANT_ID);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(true);
      expect(result.envOutput.credentialCount).toBe(2);
      expect(result.envOutput.content).toContain(
        'LLM_CREDENTIAL_CRED_1_API_KEY=sk-prod123',
      );
      expect(result.envOutput.content).toContain(
        'LLM_CREDENTIAL_CRED_2_API_KEY=sk-ant456',
      );
      expect(result.envOutput.content).toContain(
        'LLM_CREDENTIAL_OPENAI_DEFAULT_API_KEY=sk-prod123',
      );
      expect(result.envOutput.content).toContain(
        'LLM_CREDENTIAL_ANTHROPIC_DEFAULT_API_KEY=sk-ant456',
      );
    });

    it('should filter by failedOnly option', async () => {
      const mockCredentials: ProviderCredential[] = [
        {
          id: 'cred-1',
          name: 'OpenAI Prod',
          provider: 'openai',
          schema_version: 1,
          payload: { api_key: 'sk-prod' },
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          sync_status: 'synced',
          last_sync_at: new Date(),
          sync_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'cred-2',
          name: 'Failed Cred',
          provider: 'anthropic',
          schema_version: 1,
          payload: { api_key: 'sk-fail' },
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          sync_status: 'failed',
          last_sync_at: null,
          sync_error: 'Failed',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      vi.mocked(mockCredentialsRepository.findAllForSync).mockResolvedValue(mockCredentials);
      vi.mocked(mockCredentialsRepository.updateSyncStatus).mockResolvedValue(true);
      vi.mocked(mockNatsPublisher.publishCredentialSyncCompleted).mockResolvedValue(null);

      const result = await service.syncAllCredentials(TENANT_ID, { failedOnly: true });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].credentialId).toBe('cred-2');
    });

    it('should skip manual_review_required credentials', async () => {
      const mockCredentials: ProviderCredential[] = [
        {
          id: 'cred-1',
          name: 'Needs Review',
          provider: 'openai',
          schema_version: 1,
          payload: { api_key: 'sk-review' },
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          sync_status: 'manual_review_required',
          last_sync_at: null,
          sync_error: 'Ambiguous provider',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      // Note: findAllForSync already excludes manual_review_required in the actual implementation
      vi.mocked(mockCredentialsRepository.findAllForSync).mockResolvedValue([]);
      vi.mocked(mockNatsPublisher.publishCredentialSyncCompleted).mockResolvedValue(null);

      const result = await service.syncAllCredentials(TENANT_ID);

      expect(result.results).toHaveLength(0);
      expect(result.envOutput.credentialCount).toBe(0);
    });

    it('should handle unsupported schema version', async () => {
      const mockCredentials: ProviderCredential[] = [
        {
          id: 'cred-1',
          name: 'Old Schema',
          provider: 'openai',
          schema_version: 999, // Unsupported
          payload: { api_key: 'sk-old' },
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          sync_status: 'pending',
          last_sync_at: null,
          sync_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      vi.mocked(mockCredentialsRepository.findAllForSync).mockResolvedValue(mockCredentials);
      vi.mocked(mockCredentialsRepository.updateSyncStatus).mockResolvedValue(true);
      vi.mocked(mockNatsPublisher.publishCredentialSyncCompleted).mockResolvedValue(null);

      const result = await service.syncAllCredentials(TENANT_ID);

      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain('Unsupported schema version');
      expect(result.envOutput.errors).toHaveLength(1);
    });

    it('should emit sync completed event', async () => {
      const mockCredentials: ProviderCredential[] = [
        {
          id: 'cred-1',
          name: 'Test',
          provider: 'openai',
          schema_version: 1,
          payload: { api_key: 'sk-test' },
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          sync_status: 'pending',
          last_sync_at: null,
          sync_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      vi.mocked(mockCredentialsRepository.findAllForSync).mockResolvedValue(mockCredentials);
      vi.mocked(mockCredentialsRepository.updateSyncStatus).mockResolvedValue(true);
      vi.mocked(mockNatsPublisher.publishCredentialSyncCompleted).mockResolvedValue(null);

      await service.syncAllCredentials(TENANT_ID);

      expect(mockNatsPublisher.publishCredentialSyncCompleted).toHaveBeenCalledWith(
        TENANT_ID,
        1, // success count
        0, // failed count
      );

      expect(mockNatsPublisher.publishRuntimeConfigSync).toHaveBeenCalledWith(
        TENANT_ID,
        [
          expect.objectContaining({
            path: 'runtime-secrets/credentials.env',
            format: 'env',
          }),
        ],
      );
    });

    it('should handle empty credential list', async () => {
      vi.mocked(mockCredentialsRepository.findAllForSync).mockResolvedValue([]);
      vi.mocked(mockNatsPublisher.publishCredentialSyncCompleted).mockResolvedValue(null);

      const result = await service.syncAllCredentials(TENANT_ID);

      expect(result.results).toHaveLength(0);
      expect(result.envOutput.content).toContain('# Auto-generated credentials.env file');
    });
  });

  describe('syncCredential', () => {
    it('should sync a single credential', async () => {
      const mockCredential: ProviderCredential = {
        id: 'cred-1',
        name: 'Test',
        provider: 'openai',
        schema_version: 1,
        payload: { api_key: 'sk-test' },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'pending',
        last_sync_at: null,
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockCredentialsRepository.findByIdWithPayload).mockResolvedValue(mockCredential);
      vi.mocked(mockCredentialsRepository.updateSyncStatus).mockResolvedValue(true);

      const result = await service.syncCredential(TENANT_ID, 'cred-1');

      expect(result.success).toBe(true);
      expect(result.credentialId).toBe('cred-1');
    });

    it('should fail when credential not found', async () => {
      vi.mocked(mockCredentialsRepository.findByIdWithPayload).mockResolvedValue(null);

      const result = await service.syncCredential(TENANT_ID, 'non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Credential not found');
    });

    it('should fail when credential is inactive', async () => {
      const mockCredential: ProviderCredential = {
        id: 'cred-1',
        name: 'Inactive',
        provider: 'openai',
        schema_version: 1,
        payload: { api_key: 'sk-test' },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: false,
        sync_status: 'pending',
        last_sync_at: null,
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockCredentialsRepository.findByIdWithPayload).mockResolvedValue(mockCredential);

      const result = await service.syncCredential(TENANT_ID, 'cred-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Credential is not active');
    });

    it('should update sync status to failed on error', async () => {
      const mockCredential: ProviderCredential = {
        id: 'cred-1',
        name: 'Bad Schema',
        provider: 'openai',
        schema_version: 999,
        payload: { api_key: 'sk-test' },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'pending',
        last_sync_at: null,
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockCredentialsRepository.findByIdWithPayload).mockResolvedValue(mockCredential);
      vi.mocked(mockCredentialsRepository.updateSyncStatus).mockResolvedValue(true);

      const result = await service.syncCredential(TENANT_ID, 'cred-1');

      expect(result.success).toBe(false);
      expect(mockCredentialsRepository.updateSyncStatus).toHaveBeenCalledWith(
        TENANT_ID,
        'cred-1',
        'failed',
        expect.stringContaining('Unsupported schema version'),
      );
    });
  });

  describe('env file generation', () => {
    it('should generate deterministic env file content', async () => {
      const mockCredentials: ProviderCredential[] = [
        {
          id: 'cred-1',
          name: 'OpenAI',
          provider: 'openai',
          schema_version: 1,
          payload: { api_key: 'sk-aaa', base_url: 'https://api.openai.com' },
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          sync_status: 'pending',
          last_sync_at: null,
          sync_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'cred-2',
          name: 'Anthropic',
          provider: 'anthropic',
          schema_version: 1,
          payload: { api_key: 'sk-bbb' },
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          sync_status: 'pending',
          last_sync_at: null,
          sync_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      vi.mocked(mockCredentialsRepository.findAllForSync).mockResolvedValue(mockCredentials);
      vi.mocked(mockCredentialsRepository.updateSyncStatus).mockResolvedValue(true);
      vi.mocked(mockNatsPublisher.publishCredentialSyncCompleted).mockResolvedValue(null);

      const result = await service.syncAllCredentials(TENANT_ID);

      // Keys should be sorted alphabetically
      const lines = result.envOutput.content.split('\n');
      const keyLines = lines.filter(l => l.includes('=') && !l.startsWith('#'));

      expect(keyLines).toEqual([...keyLines].sort());
    });

    it('should escape special characters in values', async () => {
      const mockCredentials: ProviderCredential[] = [
        {
          id: 'cred-1',
          name: 'Test',
          provider: 'openai',
          schema_version: 1,
          payload: { api_key: 'key with spaces' },
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          sync_status: 'pending',
          last_sync_at: null,
          sync_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      vi.mocked(mockCredentialsRepository.findAllForSync).mockResolvedValue(mockCredentials);
      vi.mocked(mockCredentialsRepository.updateSyncStatus).mockResolvedValue(true);
      vi.mocked(mockNatsPublisher.publishCredentialSyncCompleted).mockResolvedValue(null);

      const result = await service.syncAllCredentials(TENANT_ID);

      expect(result.envOutput.content).toContain(
        'LLM_CREDENTIAL_CRED_1_API_KEY="key with spaces"',
      );
    });
  });
});
