import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import {
  CredentialsRepository,
  type CredentialWithoutValue,
  type CreateCredentialData,
} from './credentials.repository';
import { NatsPublisher } from '../../providers/nats.provider';

describe('CredentialsService', () => {
  let service: CredentialsService;
  let mockRepository: CredentialsRepository;
  let mockNatsPublisher: NatsPublisher;
  const TENANT_ID = 'tenant-123';

  beforeEach(async () => {
    mockRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      findByIdWithValue: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      rotate: vi.fn(),
    } as unknown as CredentialsRepository;

    mockNatsPublisher = {
      publishCredentialRotated: vi.fn(),
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
    it('should return credentials without value field', async () => {
      const mockCredentials: CredentialWithoutValue[] = [
        {
          id: 'cred-1',
          name: 'Test API Key',
          type: 'api_key',
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      vi.mocked(mockRepository.findAll).mockResolvedValue({
        credentials: mockCredentials,
        total: 1,
      });

      const result = await service.findAll(TENANT_ID, { limit: 10, offset: 0 });

      expect(result.credentials).toHaveLength(1);
      expect(result.total).toBe(1);
      // Verificar que NO tiene campo value (seguridad)
      expect(result.credentials[0]).not.toHaveProperty('value');
      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        limit: 10,
        offset: 0,
      });
    });

    it('should pass filter options to repository', async () => {
      vi.mocked(mockRepository.findAll).mockResolvedValue({
        credentials: [],
        total: 0,
      });

      await service.findAll(TENANT_ID, { type: 'api_key', is_active: true });

      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        type: 'api_key',
        is_active: true,
      });
    });
  });

  describe('findById', () => {
    it('should return credential without value field', async () => {
      const mockCredential: CredentialWithoutValue = {
        id: 'cred-1',
        name: 'Test API Key',
        type: 'api_key',
        is_encrypted: false,
        metadata: { key_id: '123' },
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.findById).mockResolvedValue(mockCredential);

      const result = await service.findById(TENANT_ID, 'cred-1');

      expect(result).toEqual(mockCredential);
      // Verificar que NO tiene campo value (seguridad)
      expect(result).not.toHaveProperty('value');
    });

    it('should throw NotFoundException when credential not found', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(null);

      expect(service.findById(TENANT_ID, 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create a new credential', async () => {
      const createData: CreateCredentialData = {
        name: 'New API Key',
        type: 'api_key',
        value: 'secret-api-key-123', // Este valor se guarda pero NUNCA se retorna
        metadata: { provider: 'openai' },
      };

      const createdCredential: CredentialWithoutValue = {
        id: 'new-cred-id',
        name: createData.name,
        type: createData.type,
        is_encrypted: false,
        metadata: createData.metadata!,
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.create).mockResolvedValue(createdCredential);

      const result = await service.create(TENANT_ID, createData);

      expect(result.name).toBe(createData.name);
      expect(result.type).toBe(createData.type);
      // Verificar que NO retorna el value (seguridad)
      expect(result).not.toHaveProperty('value');
      expect(mockRepository.create).toHaveBeenCalledWith(TENANT_ID, createData);
    });

    it('should create credential with all fields', async () => {
      const createData: CreateCredentialData = {
        name: 'OAuth Token',
        type: 'oauth',
        value: 'oauth-token-secret',
        metadata: { scopes: ['read', 'write'] },
        expires_at: '2024-12-31T23:59:59Z',
        is_active: true,
      };

      const createdCredential: CredentialWithoutValue = {
        id: 'oauth-cred-id',
        name: createData.name,
        type: createData.type,
        is_encrypted: false,
        metadata: createData.metadata!,
        expires_at: new Date(createData.expires_at!),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.create).mockResolvedValue(createdCredential);

      const result = await service.create(TENANT_ID, createData);

      expect(result.expires_at).toBeInstanceOf(Date);
      expect(result).not.toHaveProperty('value');
    });
  });

  describe('update', () => {
    it('should update credential without changing value', async () => {
      const updateData = { name: 'Updated Name' };
      const updatedCredential: CredentialWithoutValue = {
        id: 'cred-1',
        name: 'Updated Name',
        type: 'api_key',
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.update).mockResolvedValue(updatedCredential);

      const result = await service.update(TENANT_ID, 'cred-1', updateData);

      expect(result.name).toBe('Updated Name');
      // No debe emitir evento si no se actualizó el value
      expect(mockNatsPublisher.publishCredentialRotated).not.toHaveBeenCalled();
    });

    it('should update credential and emit rotation event when value changes', async () => {
      const updateData = { value: 'new-secret-value' };
      const updatedCredential: CredentialWithoutValue = {
        id: 'cred-1',
        name: 'API Key',
        type: 'api_key',
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.update).mockResolvedValue(updatedCredential);
      vi.mocked(mockNatsPublisher.publishCredentialRotated).mockResolvedValue(null);

      const result = await service.update(TENANT_ID, 'cred-1', updateData);

      expect(result).toEqual(updatedCredential);
      expect(mockNatsPublisher.publishCredentialRotated).toHaveBeenCalledWith(
        TENANT_ID,
        updatedCredential.id,
        updatedCredential.type,
      );
    });

    it('should throw NotFoundException when credential not found', async () => {
      vi.mocked(mockRepository.update).mockResolvedValue(null);

      expect(
        service.update(TENANT_ID, 'non-existent', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not fail if event emission fails', async () => {
      const updateData = { value: 'new-secret-value' };
      const updatedCredential: CredentialWithoutValue = {
        id: 'cred-1',
        name: 'API Key',
        type: 'api_key',
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.update).mockResolvedValue(updatedCredential);
      vi.mocked(mockNatsPublisher.publishCredentialRotated).mockRejectedValue(
        new Error('NATS error'),
      );

      // Should not throw even if NATS fails
      const result = await service.update(TENANT_ID, 'cred-1', updateData);

      expect(result.id).toBe('cred-1');
    });
  });

  describe('delete', () => {
    it('should delete credential', async () => {
      vi.mocked(mockRepository.delete).mockResolvedValue(true);

      await service.delete(TENANT_ID, 'cred-1');

      expect(mockRepository.delete).toHaveBeenCalledWith(TENANT_ID, 'cred-1');
    });

    it('should throw NotFoundException when credential not found', async () => {
      vi.mocked(mockRepository.delete).mockResolvedValue(false);

      expect(service.delete(TENANT_ID, 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('rotate', () => {
    it('should rotate credential value and emit event', async () => {
      const rotatedCredential: CredentialWithoutValue = {
        id: 'cred-1',
        name: 'API Key',
        type: 'api_key',
        is_encrypted: false,
        metadata: {},
        expires_at: new Date('2025-12-31T23:59:59Z'),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.rotate).mockResolvedValue(rotatedCredential);
      vi.mocked(mockNatsPublisher.publishCredentialRotated).mockResolvedValue(null);

      const result = await service.rotate(
        TENANT_ID,
        'cred-1',
        'new-rotated-value',
        '2025-12-31T23:59:59Z',
      );

      expect(result).toEqual(rotatedCredential);
      expect(mockRepository.rotate).toHaveBeenCalledWith(
        TENANT_ID,
        'cred-1',
        'new-rotated-value',
        '2025-12-31T23:59:59Z',
      );
      expect(mockNatsPublisher.publishCredentialRotated).toHaveBeenCalledWith(
        TENANT_ID,
        rotatedCredential.id,
        rotatedCredential.type,
      );
    });

    it('should rotate without new expiration date', async () => {
      const rotatedCredential: CredentialWithoutValue = {
        id: 'cred-1',
        name: 'API Key',
        type: 'api_key',
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.rotate).mockResolvedValue(rotatedCredential);
      vi.mocked(mockNatsPublisher.publishCredentialRotated).mockResolvedValue(null);

      const result = await service.rotate(TENANT_ID, 'cred-1', 'new-value');

      expect(result).toEqual(rotatedCredential);
      expect(mockRepository.rotate).toHaveBeenCalledWith(
        TENANT_ID,
        'cred-1',
        'new-value',
        undefined,
      );
    });

    it('should throw NotFoundException when credential not found', async () => {
      vi.mocked(mockRepository.rotate).mockResolvedValue(null);

      expect(
        service.rotate(TENANT_ID, 'non-existent', 'new-value'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not fail if event emission fails', async () => {
      const rotatedCredential: CredentialWithoutValue = {
        id: 'cred-1',
        name: 'API Key',
        type: 'api_key',
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.rotate).mockResolvedValue(rotatedCredential);
      vi.mocked(mockNatsPublisher.publishCredentialRotated).mockRejectedValue(
        new Error('NATS error'),
      );

      // Should not throw even if NATS fails
      const result = await service.rotate(TENANT_ID, 'cred-1', 'new-value');

      expect(result.id).toBe('cred-1');
    });
  });
});
