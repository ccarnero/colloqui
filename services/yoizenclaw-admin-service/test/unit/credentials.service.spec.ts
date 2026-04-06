import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { CredentialsService } from "../../src/modules/credentials/credentials.service";
import {
  CredentialsRepository,
  type MaskedCredential,
  type CreateProviderCredentialData,
} from "../../src/modules/credentials/credentials.repository";
import { NatsPublisher } from "../../src/providers/nats.provider";

describe("CredentialsService (Provider-Aware)", () => {
  let service: CredentialsService;
  let mockRepository: CredentialsRepository;
  let mockNatsPublisher: NatsPublisher;
  const TENANT_ID = "tenant-123";

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

  describe("findAll", () => {
    it("should return credentials with masked payloads", async () => {
      const mockCredentials: MaskedCredential[] = [
        {
          id: "cred-1",
          name: "OpenAI Production",
          provider: "openai",
          schema_version: 1,
          payload: { api_key: "sk-test123" },
          is_encrypted: false,
          metadata: {},
          expires_at: null,
          is_active: true,
          sync_status: "synced",
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
      expect(result.credentials[0].payload.api_key).toContain("****");
      expect(result.credentials[0].payload.api_key).not.toBe("sk-test123");
    });

    it("should filter by provider", async () => {
      vi.mocked(mockRepository.findAll).mockResolvedValue({
        credentials: [],
        total: 0,
      });

      await service.findAll(TENANT_ID, { provider: "openai" });

      expect(mockRepository.findAll).toHaveBeenCalledWith(TENANT_ID, {
        provider: "openai",
      });
    });
  });

  describe("findById", () => {
    it("should return credential with masked payload", async () => {
      const mockCredential: MaskedCredential = {
        id: "cred-1",
        name: "Test",
        provider: "openai",
        schema_version: 1,
        payload: { api_key: "sk-secret" },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: "synced",
        last_sync_at: null,
        sync_error: null,
        has_secret: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.findById).mockResolvedValue(mockCredential);

      const result = await service.findById(TENANT_ID, "cred-1");

      expect(result.provider).toBe("openai");
      expect(result.payload.api_key).toContain("****");
    });
  });

  describe("create (Provider-Aware)", () => {
    it("should create OpenAI credential with valid payload", async () => {
      const createData: CreateProviderCredentialData = {
        name: "OpenAI Production",
        provider: "openai",
        payload: { api_key: "sk-test123456789" },
        schema_version: 1,
      };

      const createdCredential: MaskedCredential = {
        id: "new-cred-id",
        name: createData.name,
        provider: "openai",
        schema_version: 1,
        payload: { api_key: "********" },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: "pending",
        last_sync_at: null,
        sync_error: null,
        has_secret: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.create).mockResolvedValue(createdCredential);
      vi.mocked(mockNatsPublisher.publishCredentialSync).mockResolvedValue(
        undefined,
      );

      const result = await service.create(TENANT_ID, createData);

      expect(result.provider).toBe("openai");
      expect(result.sync_status).toBe("pending");
      expect(mockRepository.create).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          name: "OpenAI Production",
          provider: "openai",
          payload: { api_key: "sk-test123456789" },
        }),
      );
    });

    it("should reject unsupported provider", async () => {
      const createData: CreateProviderCredentialData = {
        name: "Test",
        provider: "unknown" as unknown as "openai",
        payload: { api_key: "test" },
        schema_version: 1,
      };

      await expect(service.create(TENANT_ID, createData)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should reject invalid payload for provider", async () => {
      const createData: CreateProviderCredentialData = {
        name: "Test",
        provider: "openai",
        payload: {},
        schema_version: 1,
      };

      await expect(service.create(TENANT_ID, createData)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should reject missing required secret fields", async () => {
      const createData: CreateProviderCredentialData = {
        name: "Test",
        provider: "bedrock",
        payload: {
          aws_access_key_id: "AKIAIOSFODNN7EXAMPLE",
        },
        schema_version: 1,
      };

      await expect(service.create(TENANT_ID, createData)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should emit sync event after creation", async () => {
      const createData: CreateProviderCredentialData = {
        name: "Test",
        provider: "openai",
        payload: { api_key: "sk-test" },
        schema_version: 1,
      };

      const createdCredential: MaskedCredential = {
        id: "new-id",
        name: "Test",
        provider: "openai",
        schema_version: 1,
        payload: { api_key: "********" },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: "pending",
        last_sync_at: null,
        sync_error: null,
        has_secret: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.create).mockResolvedValue(createdCredential);
      vi.mocked(mockNatsPublisher.publishCredentialSync).mockResolvedValue(
        undefined,
      );

      await service.create(TENANT_ID, createData);

      expect(mockNatsPublisher.publishCredentialSync).toHaveBeenCalledWith(
        TENANT_ID,
        "new-id",
        "openai",
      );
    });
  });

  describe("update (Provider-Aware)", () => {
    it("should update non-secret fields without changing payload secrets", async () => {
      const existingCredential = {
        id: "cred-1",
        name: "Test",
        provider: "openai",
        schema_version: 1,
        payload: {
          api_key: "sk-existing",
          base_url: "https://api.openai.com",
        },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: "synced",
        last_sync_at: new Date(),
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const updatedCredential: MaskedCredential = {
        ...existingCredential,
        name: "Updated Name",
        sync_status: "pending",
        has_secret: true,
      };

      vi.mocked(mockRepository.findByIdWithPayload).mockResolvedValue(
        existingCredential,
      );
      vi.mocked(mockRepository.update).mockResolvedValue(updatedCredential);
      vi.mocked(mockNatsPublisher.publishCredentialSync).mockResolvedValue(
        undefined,
      );

      const result = await service.update(TENANT_ID, "cred-1", {
        name: "Updated Name",
      });

      expect(result.name).toBe("Updated Name");
      expect(mockRepository.update).toHaveBeenCalledWith(
        TENANT_ID,
        "cred-1",
        { name: "Updated Name" },
      );
    });

    it("should reject invalid provider change", async () => {
      const existingCredential = {
        id: "cred-1",
        name: "Test",
        provider: "openai",
        schema_version: 1,
        payload: { api_key: "sk-test" },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: "synced",
        last_sync_at: null,
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.findByIdWithPayload).mockResolvedValue(
        existingCredential,
      );

      await expect(
        service.update(TENANT_ID, "cred-1", {
          provider: "invalid" as unknown as "openai",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("rotate (Provider-Aware)", () => {
    it("should rotate with new provider payload", async () => {
      const existingCredential = {
        id: "cred-1",
        name: "Test",
        provider: "openai",
        schema_version: 1,
        payload: { api_key: "sk-old" },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: "synced",
        last_sync_at: new Date(),
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const rotatedCredential: MaskedCredential = {
        id: "cred-1",
        name: "Test",
        provider: "openai",
        schema_version: 1,
        payload: { api_key: "********" },
        is_encrypted: false,
        metadata: {},
        expires_at: new Date("2025-12-31"),
        is_active: true,
        sync_status: "pending",
        last_sync_at: null,
        sync_error: null,
        has_secret: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.findByIdWithPayload).mockResolvedValue(
        existingCredential,
      );
      vi.mocked(mockRepository.rotate).mockResolvedValue(rotatedCredential);
      vi.mocked(mockNatsPublisher.publishCredentialRotated).mockResolvedValue(
        null,
      );
      vi.mocked(mockNatsPublisher.publishCredentialSync).mockResolvedValue(
        undefined,
      );

      const result = await service.rotate(
        TENANT_ID,
        "cred-1",
        { api_key: "sk-new-secret" },
        "2025-12-31",
      );

      expect(result.sync_status).toBe("pending");
      expect(mockRepository.rotate).toHaveBeenCalledWith(
        TENANT_ID,
        "cred-1",
        { api_key: "sk-new-secret" },
        "2025-12-31",
      );
      expect(mockNatsPublisher.publishCredentialRotated).toHaveBeenCalled();
    });

    it("should reject invalid payload during rotation", async () => {
      const existingCredential = {
        id: "cred-1",
        name: "Test",
        provider: "openai",
        schema_version: 1,
        payload: { api_key: "sk-old" },
        is_encrypted: false,
        metadata: {},
        expires_at: null,
        is_active: true,
        sync_status: "synced",
        last_sync_at: new Date(),
        sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockRepository.findByIdWithPayload).mockResolvedValue(
        existingCredential,
      );

      await expect(
        service.rotate(TENANT_ID, "cred-1", {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("updateSyncStatus", () => {
    it("should update sync status", async () => {
      vi.mocked(mockRepository.updateSyncStatus).mockResolvedValue(true);

      await service.updateSyncStatus(TENANT_ID, "cred-1", "synced");

      expect(mockRepository.updateSyncStatus).toHaveBeenCalledWith(
        TENANT_ID,
        "cred-1",
        "synced",
        undefined,
      );
    });

    it("should throw NotFoundException when credential not found", async () => {
      vi.mocked(mockRepository.updateSyncStatus).mockResolvedValue(false);

      await expect(
        service.updateSyncStatus(TENANT_ID, "non-existent", "synced"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("findAllForSync", () => {
    it("should call repository findAllForSync", async () => {
      const mockCredentials = [
        {
          id: "cred-1",
          provider: "openai",
          payload: { api_key: "sk-secret" },
        },
      ];

      vi.mocked(mockRepository.findAllForSync).mockResolvedValue(
        mockCredentials as unknown as ReturnType<
          typeof mockRepository.findAllForSync
        >,
      );

      const result = await service.findAllForSync(TENANT_ID);

      expect(result).toEqual(mockCredentials);
      expect(mockRepository.findAllForSync).toHaveBeenCalledWith(TENANT_ID);
    });
  });
});
