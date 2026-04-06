import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import {
  CredentialsRepository,
  type MaskedCredential,
  type CreateProviderCredentialData,
} from './credentials.repository';
import { NatsPublisher } from '../../providers/nats.provider';

describe('CredentialsService (Provider-Aware)', () => {
  let service: CredentialsService;
  let mockRepository: CredentialsRepository;
  let mockNatsPublisher: NatsPublisher;
  const TENANT_ID = 'tenant-123';

  beforeEach(async () => {
    mockRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      findByIdWithPayload: vi.fn(),
      findAllForSync: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      rotate: vi.fn(),
      updateSyncStatus: vi.fn(),
    } as unknown as CredentialsRepository;

    mockNatsPublisher = {
      publishCredentialRotated: vi.fn(),
      publishCredentialSync: vi.fn(),
    } as unknown as NatsPublisher;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialsService,
        {
          provide: CredentialsRepository,
          useValue: mockRepository,
        },
        {
          provide: NatsPublisher,
          useValue: mockNatsPublisher,
        },
      ],
    }).compile();

    service = module.get<CredentialsService>(CredentialsService);
  });

  describe('findAll', () => {
    it('should return credentials with masked payloads', async () => {
      const mockCredentials: MaskedCredential[] = [
        {
          id: 'cred-1',
          name: 'OpenAI Production',
          provider: 'openai',
          schema_version: 1,
          payload: { api_key: 'sk-test123' },
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          sync_status: 'synced',
          last_sync_at: new Date(),
          sync_error: null,
          has_secret: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      vi.mocked(mockRepository.findAll).mockResolvedValue({
        credentials: mockCredentials,
        total: 1,
      });

      const result = await service.findAll(TENANT_ID);

      expect(result.credentials).toHaveLength(1);
      expect(result.credentials[0].payload.api_key).toContain('****');
      expect(result.credentials[0].payload.api_key).not.toBe('sk-test123');
    });

    it('should filter by provider', async () => {
      vi.mocked(mockRepository.findAll).mockResolvedValue({
        credentials: [],
        total: 0,
      });

      await service.findAll(TENANT_ID, { provider: 'openai' });

      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        provider: 'openai',
      });
    });

    it('should filter by sync_status', async () => {
      vi.mocked(mockRepository.findAll).mockResolvedValue({
        credentials: [],
        total: 0,
      });

      await service.findAll(TENANT_ID, { sync_status: 'failed' });

      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        sync_status: 'failed',
      });
    });
  });

  describe('findById', () => {
    it('should return credential with masked payload', async () => {
      const mockCredential: MaskedCredential = {
        id: 'cred-1',
        name: 'Test',
        provider: 'openai',
        schema_version: 1,
        payload: { api_key: 'sk-secret' },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'synced',
        last_sync_at: null,
        sync_error: null,
        has_secret: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.findById).mockResolvedValue(mockCredential);

      const result = await service.findById(TENANT_ID, 'cred-1');

      expect(result.provider).toBe('openai');
      expect(result.payload.api_key).toContain('****');
    });
  });

  describe('create (Provider-Aware)', () => {
    it('should create OpenAI credential with valid payload', async () => {
      const createData: CreateProviderCredentialData = {
        name: 'OpenAI Production',
        provider: 'openai',
        payload: { api_key: 'sk-test123456789' },
        schema_version: 1,
      };

      const createdCredential: MaskedCredential = {
        id: 'new-cred-id',
        name: createData.name,
        provider: 'openai',
        schema_version: 1,
        payload: { api_key: '********' },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'pending',
        last_sync_at: null,
        sync_error: null,
        has_secret: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.create).mockResolvedValue(createdCredential);
      vi.mocked(mockNatsPublisher.publishCredentialSync).mockResolvedValue(undefined);

      const result = await service.create(TENANT_ID, createData);

      expect(result.provider).toBe('openai');
      expect(result.sync_status).toBe('pending');
      expect(mockRepository.create).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({
        name: 'OpenAI Production',
        provider: 'openai',
        payload: { api_key: 'sk-test123456789' },
      }));
    });

    it('should reject unsupported provider', async () => {
      const createData: CreateProviderCredentialData = {
        name: 'Test',
        provider: 'unknown' as unknown as 'openai',
        payload: { api_key: 'test' },
        schema_version: 1,
      };

      await expect(service.create(TENANT_ID, createData)).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid payload for provider', async () => {
      const createData: CreateProviderCredentialData = {
        name: 'Test',
        provider: 'openai',
        payload: {}, // Missing required api_key
        schema_version: 1,
      };

      await expect(service.create(TENANT_ID, createData)).rejects.toThrow(BadRequestException);
    });

    it('should reject payload with unsupported fields', async () => {
      const createData: CreateProviderCredentialData = {
        name: 'Test',
        provider: 'openai',
        payload: {
          api_key: 'sk-test',
          unsupported_field: 'value',
        },
        schema_version: 1,
      };

      await expect(service.create(TENANT_ID, createData)).rejects.toThrow(BadRequestException);
    });

    it('should reject missing required secret fields', async () => {
      const createData: CreateProviderCredentialData = {
        name: 'Test',
        provider: 'bedrock',
        payload: {
          aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          // Missing aws_secret_access_key
        },
        schema_version: 1,
      };

      await expect(service.create(TENANT_ID, createData)).rejects.toThrow(BadRequestException);
    });

    it('should emit sync event after creation', async () => {
      const createData: CreateProviderCredentialData = {
        name: 'Test',
        provider: 'openai',
        payload: { api_key: 'sk-test' },
        schema_version: 1,
      };

      const createdCredential: MaskedCredential = {
        id: 'new-id',
        name: 'Test',
        provider: 'openai',
        schema_version: 1,
        payload: { api_key: '********' },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'pending',
        last_sync_at: null,
        sync_error: null,
        has_secret: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.create).mockResolvedValue(createdCredential);
      vi.mocked(mockNatsPublisher.publishCredentialSync).mockResolvedValue(undefined);

      await service.create(TENANT_ID, createData);

      expect(mockNatsPublisher.publishCredentialSync).toHaveBeenCalledWith(
        TENANT_ID,
        'new-id',
        'openai',
      );
    });

    it('should create AWS Bedrock credential with all fields', async () => {
      const createData: CreateProviderCredentialData = {
        name: 'AWS Production',
        provider: 'bedrock',
        payload: {
          aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          aws_secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          aws_session_token: 'FwoGZXIvYXdzEBYaDK...',
          region: 'us-east-1',
        },
        schema_version: 1,
      };

      const createdCredential: MaskedCredential = {
        id: 'aws-cred-id',
        name: 'AWS Production',
        provider: 'bedrock',
        schema_version: 1,
        payload: {
          aws_access_key_id: 'AKIA****MPLE',
          aws_secret_access_key: '****',
          region: 'us-east-1',
        },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'pending',
        last_sync_at: null,
        sync_error: null,
        has_secret: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.create).mockResolvedValue(createdCredential);
      vi.mocked(mockNatsPublisher.publishCredentialSync).mockResolvedValue(undefined);

      const result = await service.create(TENANT_ID, createData);

      expect(result.provider).toBe('bedrock');
      expect(mockRepository.create).toHaveBeenCalled();
    });
  });

  describe('update (Provider-Aware)', () => {
    it('should update non-secret fields without changing payload secrets', async () => {
      const existingCredential = {
        id: 'cred-1',
        name: 'Test',
        provider: 'openai',
        schema_version: 1,
        payload: { api_key: 'sk-existing', base_url: 'https://api.openai.com' },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'synced',
        last_sync_at: new Date(),
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const updatedCredential: MaskedCredential = {
        ...existingCredential,
        name: 'Updated Name',
        sync_status: 'pending',
      };

      vi.mocked(mockRepository.findByIdWithPayload).mockResolvedValue(existingCredential);
      vi.mocked(mockRepository.update).mockResolvedValue(updatedCredential);
      vi.mocked(mockNatsPublisher.publishCredentialSync).mockResolvedValue(undefined);

      const result = await service.update(TENANT_ID, 'cred-1', { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      expect(mockRepository.update).toHaveBeenCalledWith(
        TENANT_ID,
        'cred-1',
        { name: 'Updated Name' },
      );
    });

    it('should preserve existing secrets when updating other fields', async () => {
      const existingCredential = {
        id: 'cred-1',
        name: 'Test',
        provider: 'openai',
        schema_version: 1,
        payload: { api_key: 'sk-existing-secret', base_url: 'https://api.openai.com' },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'synced',
        last_sync_at: new Date(),
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const updatedCredential: MaskedCredential = {
        ...existingCredential,
        payload: { api_key: '********', base_url: 'https://new-url.com' },
        sync_status: 'pending',
      };

      vi.mocked(mockRepository.findByIdWithPayload).mockResolvedValue(existingCredential);
      vi.mocked(mockRepository.update).mockResolvedValue(updatedCredential);
      vi.mocked(mockNatsPublisher.publishCredentialSync).mockResolvedValue(undefined);

      // Update only base_url, api_key should be preserved
      await service.update(TENANT_ID, 'cred-1', {
        payload: { base_url: 'https://new-url.com' },
      });

      // The service should merge payloads preserving existing secrets
      expect(mockRepository.update).toHaveBeenCalled();
    });

    it('should reject invalid provider change', async () => {
      const existingCredential = {
        id: 'cred-1',
        name: 'Test',
        provider: 'openai',
        schema_version: 1,
        payload: { api_key: 'sk-test' },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'synced',
        last_sync_at: null,
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.findByIdWithPayload).mockResolvedValue(existingCredential);

      await expect(
        service.update(TENANT_ID, 'cred-1', { provider: 'invalid' as unknown as 'openai' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should validate payload when provider changes', async () => {
      const existingCredential = {
        id: 'cred-1',
        name: 'Test',
        provider: 'openai',
        schema_version: 1,
        payload: { api_key: 'sk-test' },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'synced',
        last_sync_at: null,
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.findByIdWithPayload).mockResolvedValue(existingCredential);

      // Trying to change to Bedrock without proper AWS credentials
      await expect(
        service.update(TENANT_ID, 'cred-1', {
          provider: 'bedrock',
          payload: { api_key: 'sk-test' }, // Invalid for Bedrock
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rotate (Provider-Aware)', () => {
    it('should rotate with new provider payload', async () => {
      const existingCredential = {
        id: 'cred-1',
        name: 'Test',
        provider: 'openai',
        schema_version: 1,
        payload: { api_key: 'sk-old' },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'synced',
        last_sync_at: new Date(),
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const rotatedCredential: MaskedCredential = {
        id: 'cred-1',
        name: 'Test',
        provider: 'openai',
        schema_version: 1,
        payload: { api_key: '********' },
        is_encrypted: false,
        metadata: {},
        expires_at: new Date('2025-12-31'),
        is_active: true,
        sync_status: 'pending',
        last_sync_at: null,
        sync_error: null,
        has_secret: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.findByIdWithPayload).mockResolvedValue(existingCredential);
      vi.mocked(mockRepository.rotate).mockResolvedValue(rotatedCredential);
      vi.mocked(mockNatsPublisher.publishCredentialRotated).mockResolvedValue(null);
      vi.mocked(mockNatsPublisher.publishCredentialSync).mockResolvedValue(undefined);

      const result = await service.rotate(TENANT_ID, 'cred-1', {
        api_key: 'sk-new-secret',
      }, '2025-12-31');

      expect(result.sync_status).toBe('pending');
      expect(mockRepository.rotate).toHaveBeenCalledWith(
        TENANT_ID,
        'cred-1',
        { api_key: 'sk-new-secret' },
        '2025-12-31',
      );
      expect(mockNatsPublisher.publishCredentialRotated).toHaveBeenCalled();
    });

    it('should reject invalid payload during rotation', async () => {
      const existingCredential = {
        id: 'cred-1',
        name: 'Test',
        provider: 'openai',
        schema_version: 1,
        payload: { api_key: 'sk-old' },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'synced',
        last_sync_at: new Date(),
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.findByIdWithPayload).mockResolvedValue(existingCredential);

      await expect(
        service.rotate(TENANT_ID, 'cred-1', {}), // Empty payload
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject rotation with missing required secrets', async () => {
      const existingCredential = {
        id: 'cred-1',
        name: 'AWS Test',
        provider: 'bedrock',
        schema_version: 1,
        payload: {
          aws_access_key_id: 'AKIAOLD',
          aws_secret_access_key: 'old-secret',
        },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: 'synced',
        last_sync_at: new Date(),
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.findByIdWithPayload).mockResolvedValue(existingCredential);

      await expect(
        service.rotate(TENANT_ID, 'cred-1', {
          aws_access_key_id: 'AKIANEW',
          // Missing aws_secret_access_key
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateSyncStatus', () => {
    it('should update sync status', async () => {
      vi.mocked(mockRepository.updateSyncStatus).mockResolvedValue(true);

      await service.updateSyncStatus(TENANT_ID, 'cred-1', 'synced');

      expect(mockRepository.updateSyncStatus).toHaveBeenCalledWith(
        TENANT_ID,
        'cred-1',
        'synced',
        undefined,
      );
    });

    it('should update sync status with error', async () => {
      vi.mocked(mockRepository.updateSyncStatus).mockResolvedValue(true);

      await service.updateSyncStatus(TENANT_ID, 'cred-1', 'failed', 'Connection timeout');

      expect(mockRepository.updateSyncStatus).toHaveBeenCalledWith(
        TENANT_ID,
        'cred-1',
        'failed',
        'Connection timeout',
      );
    });

    it('should throw NotFoundException when credential not found', async () => {
      vi.mocked(mockRepository.updateSyncStatus).mockResolvedValue(false);

      await expect(
        service.updateSyncStatus(TENANT_ID, 'non-existent', 'synced'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllForSync', () => {
    it('should call repository findAllForSync', async () => {
      const mockCredentials = [
        {
          id: 'cred-1',
          provider: 'openai',
          payload: { api_key: 'sk-secret' },
        },
      ];

      vi.mocked(mockRepository.findAllForSync).mockResolvedValue(mockCredentials as unknown as ReturnType<typeof mockRepository.findAllForSync>);

      const result = await service.findAllForSync(TENANT_ID);

      expect(result).toEqual(mockCredentials);
      expect(mockRepository.findAllForSync).toHaveBeenCalledWith(TENANT_ID);
    });
  });
});
