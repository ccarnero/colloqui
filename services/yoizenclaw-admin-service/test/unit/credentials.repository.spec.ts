import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CredentialsRepository,
  type Credential,
  type CredentialWithoutValue,
  type CreateCredentialData,
} from './credentials.repository';
import { TenantConnectionManager, type Sql } from '../../providers/tenant-connection-manager';

// Mock postgres sql tagged template
const createMockSql = (): Sql => {
  const mockQuery = vi.fn();

  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      return mockQuery(strings, ...values);
    },
    {
      unsafe: vi.fn((value: string) => value),
      json: vi.fn((value: unknown) => JSON.stringify(value)),
      begin: vi.fn(),
      end: vi.fn(),
    }
  ) as unknown as Sql;

  // Attach the mockQuery to access it in tests
  (sql as unknown as { _mockQuery: typeof mockQuery })._mockQuery = mockQuery;

  return sql;
};

describe('CredentialsRepository', () => {
  let repository: CredentialsRepository;
  let mockConnectionManager: TenantConnectionManager;
  let mockSql: Sql;
  const TENANT_ID = 'tenant-123';

  beforeEach(async () => {
    mockSql = createMockSql();

    mockConnectionManager = {
      getConnection: vi.fn().mockReturnValue(mockSql),
    } as unknown as TenantConnectionManager;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialsRepository,
        {
          provide: TenantConnectionManager,
          useValue: mockConnectionManager,
        },
      ],
    }).compile();

    repository = module.get<CredentialsRepository>(CredentialsRepository);
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

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;

      // First call is for count
      mockQuery.mockResolvedValueOnce([{ count: 1 }]);
      // Second call is for credentials
      mockQuery.mockResolvedValueOnce(mockCredentials);

      const result = await repository.findAll(TENANT_ID);

      expect(result.credentials).toHaveLength(1);
      expect(result.total).toBe(1);
      // Verificar que NO tiene campo value (seguridad)
      expect(result.credentials[0]).not.toHaveProperty('value');
      expect(mockConnectionManager.getConnection).toHaveBeenCalledWith(TENANT_ID);
    });

    it('should filter by type', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 0 }]);
      mockQuery.mockResolvedValueOnce([]);

      await repository.findAll(TENANT_ID, { type: 'oauth' });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should use custom limit and offset', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([{ count: 100 }]);
      mockQuery.mockResolvedValueOnce([]);

      await repository.findAll(TENANT_ID, { limit: 10, offset: 20 });

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return credential without value field', async () => {
      const mockCredential: CredentialWithoutValue = {
        id: 'cred-1',
        name: 'Test API Key',
        type: 'api_key',
        is_encrypted: false,
        metadata: { provider: 'test' },
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([mockCredential]);

      const result = await repository.findById(TENANT_ID, 'cred-1');

      expect(result).toEqual(mockCredential);
      // Verificar que NO tiene campo value (seguridad)
      expect(result).not.toHaveProperty('value');
    });

    it('should return null when credential not found', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.findById(TENANT_ID, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithValue', () => {
    it('should return credential with value field for internal use', async () => {
      const mockCredential: Credential = {
        id: 'cred-1',
        name: 'Test API Key',
        type: 'api_key',
        value: 'secret-value-123', // Este método SÍ retorna el value
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([mockCredential]);

      const result = await repository.findByIdWithValue(TENANT_ID, 'cred-1');

      expect(result).toEqual(mockCredential);
      // Este método SÍ debe tener el campo value
      expect(result).toHaveProperty('value');
      expect(result?.value).toBe('secret-value-123');
    });

    it('should return null when credential not found', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.findByIdWithValue(TENANT_ID, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new credential with is_encrypted false', async () => {
      const createData: CreateCredentialData = {
        name: 'New API Key',
        type: 'api_key',
        value: 'secret-key-123',
        metadata: { provider: 'openai' },
      };

      const createdCredential: CredentialWithoutValue = {
        id: 'new-cred-id',
        name: createData.name,
        type: createData.type,
        is_encrypted: false, // FIXME: Implementar cifrado con KMS/Vault
        metadata: createData.metadata!,
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([createdCredential]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.id).toBe('new-cred-id');
      expect(result.is_encrypted).toBe(false); // Placeholder hasta implementar cifrado
      expect(result).not.toHaveProperty('value');
    });

    it('should create credential with expiration', async () => {
      const createData: CreateCredentialData = {
        name: 'OAuth Token',
        type: 'oauth',
        value: 'oauth-secret',
        expires_at: '2024-12-31T23:59:59Z',
      };

      const createdCredential: CredentialWithoutValue = {
        id: 'oauth-id',
        name: createData.name,
        type: createData.type,
        is_encrypted: false,
        metadata: {},
        expires_at: new Date(createData.expires_at!),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([createdCredential]);

      const result = await repository.create(TENANT_ID, createData);

      expect(result.expires_at).toBeInstanceOf(Date);
      expect(result.is_encrypted).toBe(false);
    });
  });

  describe('update', () => {
    it('should update credential fields without changing value', async () => {
      const updatedCredential: CredentialWithoutValue = {
        id: 'cred-1',
        name: 'Updated Name',
        type: 'api_key',
        is_encrypted: false,
        metadata: { updated: true },
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([updatedCredential]);

      const result = await repository.update(TENANT_ID, 'cred-1', {
        name: 'Updated Name',
        metadata: { updated: true },
      });

      expect(result).toEqual(updatedCredential);
      expect(result?.name).toBe('Updated Name');
    });

    it('should update value and keep is_encrypted false', async () => {
      const updatedCredential: CredentialWithoutValue = {
        id: 'cred-1',
        name: 'API Key',
        type: 'api_key',
        is_encrypted: false, // FIXME: Implementar cifrado con KMS/Vault
        metadata: {},
        expires_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([updatedCredential]);

      const result = await repository.update(TENANT_ID, 'cred-1', {
        value: 'new-secret-value',
      });

      expect(result).toEqual(updatedCredential);
      expect(result?.is_encrypted).toBe(false);
    });

    it('should return null when credential not found', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.update(TENANT_ID, 'non-existent', {
        name: 'New Name',
      });

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should soft delete credential', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([{ id: 'cred-1' }]);

      const result = await repository.delete(TENANT_ID, 'cred-1');

      expect(result).toBe(true);
    });

    it('should return false when credential not found', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.delete(TENANT_ID, 'non-existent');

      expect(result).toBe(false);
    });
  });

  describe('rotate', () => {
    it('should rotate credential value with new expiration', async () => {
      const rotatedCredential: CredentialWithoutValue = {
        id: 'cred-1',
        name: 'API Key',
        type: 'api_key',
        is_encrypted: false, // FIXME: Implementar cifrado con KMS/Vault
        metadata: {},
        expires_at: new Date('2025-12-31T23:59:59Z'),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([rotatedCredential]);

      const result = await repository.rotate(
        TENANT_ID,
        'cred-1',
        'new-rotated-value',
        '2025-12-31T23:59:59Z',
      );

      expect(result).toEqual(rotatedCredential);
      expect(result?.expires_at).toBeInstanceOf(Date);
      expect(result?.is_encrypted).toBe(false);
    });

    it('should rotate credential value without expiration', async () => {
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

      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([rotatedCredential]);

      const result = await repository.rotate(TENANT_ID, 'cred-1', 'new-value');

      expect(result).toEqual(rotatedCredential);
      expect(result?.expires_at).toBeNull();
    });

    it('should return null when credential not found', async () => {
      const mockQuery = (mockSql as unknown as { _mockQuery: ReturnType<typeof vi.fn> })._mockQuery;
      mockQuery.mockResolvedValueOnce([]);

      const result = await repository.rotate(TENANT_ID, 'non-existent', 'new-value');

      expect(result).toBeNull();
    });
  });
});
